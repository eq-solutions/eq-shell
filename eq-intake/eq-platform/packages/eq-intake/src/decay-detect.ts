/**
 * @eq/intake — stale record detection
 *
 * Records that haven't been updated in a long time may have drifted out of
 * reality — phone numbers change, staff leave, assets get retired.
 * decayCheck() returns a staleness summary per entity so the health home
 * can surface the "oldest" records for review.
 */

import type { SupabaseLikeClient } from './canonical/commit-canonical.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'very_stale';

export interface StaleRecord {
  id:           string;
  label:        string;   // human-readable (e.g. company_name, first_name + last_name)
  updated_at:   string;   // ISO string from the DB
  days_since:   number;
  level:        StalenessLevel;
}

export interface DecaySummary {
  entity:      string;
  total:       number;
  fresh:       number;
  aging:       number;   // 180–364 days
  stale:       number;   // 365–539 days
  very_stale:  number;   // 540+ days
  oldest_days: number;
  stalest:     StaleRecord[];  // up to 5 most stale records
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGING_DAYS     = 180;
const STALE_DAYS     = 365;
const VERY_STALE_DAYS = 540;

// PK field per entity (for the id of StaleRecord)
const PK_FIELD: Record<string, string> = {
  staff:     'staff_id',
  customers: 'customer_id',
  sites:     'site_id',
  contacts:  'first_name',   // contacts has no single-col PK surfaced by RPC
  assets:    'name',
  licences:  'licence_id',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RpcClient = {
  rpc: (name: string, params: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function labelForRow(entity: string, row: Record<string, unknown>): string {
  if (entity === 'staff' || entity === 'contacts') {
    return `${row['first_name'] ?? ''} ${row['last_name'] ?? ''}`.trim();
  }
  if (entity === 'customers') return String(row['company_name'] ?? '');
  if (entity === 'sites' || entity === 'assets') return String(row['name'] ?? '');
  if (entity === 'licences') {
    return `${row['licence_type'] ?? ''} – ${row['staff_id'] ?? ''}`.trim();
  }
  return String(row[PK_FIELD[entity] ?? 'id'] ?? '');
}

function stalenessLevel(days: number): StalenessLevel {
  if (days < AGING_DAYS) return 'fresh';
  if (days < STALE_DAYS) return 'aging';
  if (days < VERY_STALE_DAYS) return 'stale';
  return 'very_stale';
}

function daysSince(isoStr: string, now: Date): number {
  const then = new Date(isoStr);
  if (isNaN(then.getTime())) return 0;
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Public: decayCheck
// ---------------------------------------------------------------------------

const ENTITIES = ['staff', 'customers', 'sites', 'contacts', 'assets'] as const;
type EntityKey = typeof ENTITIES[number];

export async function decayCheck(
  supabase: SupabaseLikeClient,
  now = new Date(),
): Promise<DecaySummary[]> {
  const client = supabase as unknown as RpcClient;

  const results = await Promise.all(
    ENTITIES.map((entity) =>
      client
        .rpc('eq_tidy_read_entity', { p_table: entity })
        .then((r) => ({ entity, ...r })),
    ),
  );

  return results.map(({ entity, data: rawData }) => {
    const rows = ((rawData as Record<string, unknown>[] | null) ?? []).filter(
      (r) => r['active'] !== false,
    );

    const summary: DecaySummary = {
      entity,
      total:       rows.length,
      fresh:       0,
      aging:       0,
      stale:       0,
      very_stale:  0,
      oldest_days: 0,
      stalest:     [],
    };

    const staleRecords: StaleRecord[] = [];

    for (const row of rows) {
      const updatedAt = String(row['updated_at'] ?? '');
      const days = daysSince(updatedAt, now);
      const level = stalenessLevel(days);

      summary[level]++;
      if (days > summary.oldest_days) summary.oldest_days = days;

      if (level !== 'fresh') {
        const pkField = PK_FIELD[entity] ?? 'id';
        staleRecords.push({
          id:         String(row[pkField] ?? ''),
          label:      labelForRow(entity, row),
          updated_at: updatedAt,
          days_since: days,
          level,
        });
      }
    }

    // Keep the 5 most stale
    summary.stalest = staleRecords
      .sort((a, b) => b.days_since - a.days_since)
      .slice(0, 5);

    return summary;
  });
}
