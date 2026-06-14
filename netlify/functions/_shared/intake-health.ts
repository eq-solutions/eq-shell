// Intake health + conflict engine.
//
// Given a batch of canonical rows bound for an app_data table, this computes —
// per row — a health score (0..1), a set of health flags (domain-rule
// violations, missing recommended fields), and a set of conflicts (natural-key
// matches against rows already in the tenant's table). The intake-stage
// function runs this once, server-side, and persists the result on each
// eq_intake_staging row so the reviewer sees *why* a row needs attention
// before anything is committed.
//
// Design notes:
//   - Pure + injectable. The engine never imports supabase; it receives a
//     `queryExisting` function. That keeps it unit-testable with a fake lookup
//     and keeps DB concerns in the netlify function.
//   - Per-table rules live in a registry (RULES). A table with no entry still
//     gets a clean, well-formed result (health 1.0, no conflicts) so the engine
//     degrades gracefully across all ~40 entities — we add bespoke rules only
//     where they earn their keep (licences, staff, tenders to start).
//   - One query per natural key per batch, never per row. Conflict detection
//     collects all values for a key, asks the DB once, then matches in memory.

export type Severity = 'error' | 'warning' | 'info';

export interface HealthFlag {
  /** Field the flag is about, or null for a row-level flag. */
  field: string | null;
  severity: Severity;
  reason: string;
}

export interface Conflict {
  /**
   * 'duplicate' — append mode, a row with this natural key already exists
   * (likely an unintended re-import).
   * 'update' — upsert mode, the match is the row this import will overwrite
   * (intended, but surfaced so the reviewer knows it's a mutation).
   */
  type: 'duplicate' | 'update';
  /** PK of the existing row this conflicts with. */
  match_id: string;
  /** Human summary of the existing row, e.g. "EWP #12345 — Jane Smith". */
  match_summary: string;
  /** Natural-key column(s) that matched. */
  on: string[];
}

export interface RowHealth {
  source_row_index: number;
  row_health: number; // 0..1, 1.0 = clean
  health_flags: HealthFlag[];
  conflicts: Conflict[];
}

export interface BatchHealth {
  rows: RowHealth[];
  /** Aggregate batch score, 0..100. Mean of row healths × 100. */
  score: number;
  /** Rows carrying at least one health flag. */
  flagged_count: number;
  /** Rows carrying at least one conflict. */
  conflict_count: number;
}

export type ImportMode = 'append' | 'upsert' | 'replace';

/**
 * Fetch existing rows from the tenant table whose `column` is in `values`.
 * Implementations scope to the tenant (the engine does not see tenant_id).
 * Returns whole rows so the engine can build match summaries.
 */
export type QueryExisting = (
  table: string,
  column: string,
  values: Array<string | number>,
) => Promise<Array<Record<string, unknown>>>;

type CanonRow = Record<string, unknown>;

interface NaturalKey {
  /** Column on the incoming row AND the existing table to match on. */
  column: string;
  /** PK column of the existing row, used as Conflict.match_id. */
  idField: string;
  /** Build the human-readable summary of an existing match. */
  summary: (existing: Record<string, unknown>) => string;
}

interface TableRules {
  naturalKeys: NaturalKey[];
  /** Recommended-but-not-required fields; absence is an info flag. */
  recommended: string[];
  /** Table-specific validations producing flags. */
  domainRules?: (row: CanonRow) => HealthFlag[];
}

// Flag weights — how much each issue subtracts from a row's 1.0 health.
const WEIGHT: Record<Severity, number> = { error: 0.5, warning: 0.2, info: 0.05 };
const CONFLICT_WEIGHT = { duplicate: 0.4, update: 0.1 } as const;

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/** YYYY-MM-DD in UTC for "today" comparisons. */
function todayISO(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ─── per-table rules ────────────────────────────────────────────────────────

const RULES: Record<string, TableRules> = {
  licences: {
    naturalKeys: [
      {
        column: 'licence_number',
        idField: 'licence_id',
        summary: (e) =>
          `${str(e.licence_type) ?? 'licence'} ${str(e.licence_number) ?? ''}`.trim(),
      },
    ],
    recommended: ['expiry_date', 'staff_id', 'licence_type'],
    domainRules: (row) => {
      const flags: HealthFlag[] = [];
      const issue = str(row.issue_date);
      const expiry = str(row.expiry_date);
      if (issue && expiry && expiry < issue) {
        flags.push({
          field: 'expiry_date',
          severity: 'error',
          reason: 'Expiry date is before the issue date.',
        });
      }
      return flags;
    },
  },

  staff: {
    naturalKeys: [
      {
        column: 'email',
        idField: 'staff_id',
        summary: (e) =>
          `${str(e.first_name) ?? ''} ${str(e.last_name) ?? ''} <${str(e.email) ?? ''}>`.trim(),
      },
    ],
    recommended: ['email', 'employment_type', 'trade'],
    domainRules: (row) => {
      const flags: HealthFlag[] = [];
      const start = str(row.start_date);
      const end = str(row.end_date);
      if (start && end && end < start) {
        flags.push({
          field: 'end_date',
          severity: 'error',
          reason: 'End date is before the start date.',
        });
      }
      return flags;
    },
  },

  tenders: {
    naturalKeys: [
      {
        column: 'tender_number',
        idField: 'tender_id',
        summary: (e) => `${str(e.tender_number) ?? ''} — ${str(e.title) ?? ''}`.trim(),
      },
    ],
    recommended: ['close_date', 'estimated_value_cents', 'client_name'],
  },
};

// ─── engine ─────────────────────────────────────────────────────────────────

/**
 * Compute health + conflicts for a batch of canonical rows.
 *
 * @param table       app_data table name (e.g. 'licences')
 * @param rows        canonical row payloads, index === source_row_index
 * @param importMode  drives duplicate vs update classification
 * @param queryExisting  tenant-scoped existing-row lookup
 * @param now         injected clock for deterministic "expired" checks (tests)
 */
export async function computeBatchHealth(
  table: string,
  rows: CanonRow[],
  importMode: ImportMode,
  queryExisting: QueryExisting,
  now: Date = new Date(),
): Promise<BatchHealth> {
  const rules = RULES[table];
  const today = todayISO(now);

  // Seed per-row results.
  const result: RowHealth[] = rows.map((_, i) => ({
    source_row_index: i,
    row_health: 1,
    health_flags: [],
    conflicts: [],
  }));

  // ── conflicts: one query per natural key, matched in memory ──
  if (rules) {
    for (const key of rules.naturalKeys) {
      // Collect distinct, non-empty values for this key across the batch.
      const valueToRows = new Map<string, number[]>();
      rows.forEach((row, i) => {
        const v = str(row[key.column]);
        if (v === undefined) return;
        const arr = valueToRows.get(v) ?? [];
        arr.push(i);
        valueToRows.set(v, arr);
      });
      if (valueToRows.size === 0) continue;

      const existing = await queryExisting(table, key.column, [...valueToRows.keys()]);
      const existingByValue = new Map<string, Record<string, unknown>>();
      for (const e of existing) {
        const v = str(e[key.column]);
        if (v !== undefined && !existingByValue.has(v)) existingByValue.set(v, e);
      }

      for (const [value, rowIdxs] of valueToRows) {
        const match = existingByValue.get(value);
        if (!match) continue;
        const conflict: Conflict = {
          type: importMode === 'upsert' ? 'update' : 'duplicate',
          match_id: str(match[key.idField]) ?? '',
          match_summary: key.summary(match),
          on: [key.column],
        };
        for (const i of rowIdxs) result[i].conflicts.push(conflict);
      }
    }
  }

  // ── per-row flags: domain rules + missing recommended fields ──
  rows.forEach((row, i) => {
    const flags: HealthFlag[] = [];
    if (rules?.domainRules) flags.push(...rules.domainRules(row));
    if (rules) {
      for (const field of rules.recommended) {
        if (str(row[field]) === undefined) {
          flags.push({
            field,
            severity: 'info',
            reason: `Recommended field "${field}" is empty.`,
          });
        }
      }
    }
    result[i].health_flags = flags;
  });

  // ── expired-licence is a date-relative warning; compute after seeding ──
  if (table === 'licences') {
    rows.forEach((row, i) => {
      const expiry = str(row.expiry_date);
      if (expiry && expiry < today) {
        result[i].health_flags.push({
          field: 'expiry_date',
          severity: 'warning',
          reason: 'Licence is already expired.',
        });
      }
    });
  }

  // ── score each row, then aggregate ──
  for (const r of result) {
    let health = 1;
    for (const f of r.health_flags) health -= WEIGHT[f.severity];
    for (const c of r.conflicts) health -= CONFLICT_WEIGHT[c.type];
    r.row_health = Math.max(0, Math.min(1, Number(health.toFixed(3))));
  }

  const flagged_count = result.filter((r) => r.health_flags.length > 0).length;
  const conflict_count = result.filter((r) => r.conflicts.length > 0).length;
  const score =
    result.length === 0
      ? 100
      : Math.round((result.reduce((s, r) => s + r.row_health, 0) / result.length) * 100);

  return { rows: result, score, flagged_count, conflict_count };
}
