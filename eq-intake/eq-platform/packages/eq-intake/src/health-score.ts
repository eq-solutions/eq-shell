/**
 * @eq/intake — data health scorer
 *
 * computeHealthScores() checks each core entity type for completeness of
 * required fields and returns a HealthScore[] array.
 *
 * A "complete" row has all required fields non-null and non-empty.
 * The score is the fraction of complete rows: complete / total (0–1).
 * gaps[] lists which fields are most frequently missing.
 */

import type { SupabaseLikeClient } from './canonical/commit-canonical.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthScore {
  entity:   string;       // 'staff' | 'sites' | 'assets' | 'customers' | 'contacts'
  total:    number;       // total rows for tenant
  complete: number;       // rows where all required fields are present
  score:    number;       // 0–1 (complete / total, or 1 if total === 0)
  gaps:     string[];     // field names with the most null/empty values (top 5)
}

// Required field lists per entity — mirrors NOT NULL columns in app_data schema.
const REQUIRED_FIELDS: Record<string, string[]> = {
  customers: ['company_name'],
  sites:     ['name'],
  contacts:  ['first_name', 'last_name'],
  staff:     ['first_name', 'last_name'],
  assets:    ['name', 'asset_type'],
};

// All fields to inspect for gap analysis (required + commonly-populated).
// Column names verified against app_data schema 2026-06-24.
const INSPECTED_FIELDS: Record<string, string[]> = {
  customers: ['company_name', 'email', 'primary_phone', 'abn'],
  sites:     ['name', 'address_line_1', 'suburb', 'postcode', 'customer_id'],
  contacts:  ['first_name', 'last_name', 'email', 'work_phone'],
  staff:     ['first_name', 'last_name', 'email', 'phone', 'trade', 'emergency_contact_name'],
  assets:    ['name', 'asset_type', 'serial_number', 'make', 'model'],
};

type EntityKey = keyof typeof REQUIRED_FIELDS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

function isComplete(row: Record<string, unknown>, requiredFields: string[]): boolean {
  return requiredFields.every((f) => !isBlank(row[f]));
}

function topGaps(
  rows: Record<string, unknown>[],
  fields: string[],
  limit = 5,
): string[] {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const f of fields) {
      if (isBlank(row[f])) {
        counts[f] = (counts[f] ?? 0) + 1;
      }
    }
  }

  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .filter(([, count]) => count > 0)
    .map(([field]) => field);
}

// ---------------------------------------------------------------------------
// Public: computeHealthScores
// ---------------------------------------------------------------------------

type RpcFn = (name: string, params: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function computeHealthScores(
  supabase: SupabaseLikeClient,
): Promise<HealthScore[]> {
  const entities = Object.keys(REQUIRED_FIELDS) as EntityKey[];
  const rpc = (supabase as unknown as { rpc: RpcFn }).rpc.bind(supabase);

  const results = await Promise.all(
    entities.map((entity) =>
      rpc('eq_tidy_read_entity', { p_table: entity }).then((r) => ({ entity, ...r })),
    ),
  );

  return results.map(({ entity, data: rawData, error }) => {
    const required  = REQUIRED_FIELDS[entity] ?? [];
    const inspected = INSPECTED_FIELDS[entity] ?? required;

    if (error) {
      return { entity, total: 0, complete: 0, score: 0, gaps: [`Error reading ${entity}: ${error.message}`] };
    }

    const rows     = (rawData as Record<string, unknown>[] | null) ?? [];
    const total    = rows.length;
    const complete = rows.filter((r) => isComplete(r, required)).length;
    const score    = total === 0 ? 1 : complete / total;
    const gaps     = topGaps(rows, inspected);

    return { entity, total, complete, score, gaps };
  });
}
