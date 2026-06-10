/**
 * fetch-canonical — load existing rows from the canonical Supabase database.
 *
 * Used by the reconciliation flow: before we diff a dropped file we need the
 * current state from the database so the user can see what's new, what
 * conflicts, and what's already in sync.
 *
 * The client type is structural (no hard dep on @supabase/supabase-js) —
 * the same pattern used in commit-canonical.ts.
 *
 * RLS is enforced by the Supabase server; we only get back the current
 * tenant's rows. The caller provides the client (already authenticated).
 */

// ---------------------------------------------------------------------------
// Client interface (structural — mirrors the subset we use from supabase-js)
// ---------------------------------------------------------------------------

export interface CanonicalFetchClient {
  from: (table: string) => {
    select: (columns?: string) => Promise<{
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Entity → table name mapping
// ---------------------------------------------------------------------------

/** Canonical entity names the reconciler knows about. */
export type CanonicalEntity = "staff" | "sites" | "assets" | "customers" | "contacts";

const ENTITY_TABLE: Record<CanonicalEntity, string> = {
  staff: "staff",
  sites: "sites",
  assets: "assets",
  customers: "customers",
  contacts: "contacts",
};

/**
 * Map a classify() entity string to the canonical table name.
 * Returns null if the entity is not one we can fetch from canonical.
 */
export function entityToTable(entity: string): string | null {
  if (entity in ENTITY_TABLE) return ENTITY_TABLE[entity as CanonicalEntity];

  // Common aliases / plurals / SimPRO names
  const aliasMap: Record<string, string> = {
    customer: "customers",
    site: "sites",
    contact: "contacts",
    asset: "assets",
    worker: "staff",
    employee: "staff",
    licence: "staff", // licences live with staff in many layouts
  };

  return aliasMap[entity.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Main fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch all rows for a given canonical entity. Returns an empty array (not
 * an error) when the table is empty or the entity is unrecognised — the
 * reconciler treats zero canonical rows as "everything is new".
 */
export async function fetchCanonicalRows(
  supabaseClient: CanonicalFetchClient,
  entity: string,
): Promise<Record<string, unknown>[]> {
  const table = entityToTable(entity);
  if (!table) {
    // Entity not in canonical — return empty so the diff shows everything as new.
    return [];
  }

  const { data, error } = await supabaseClient.from(table).select();

  if (error) {
    throw new Error(`fetchCanonicalRows(${table}): ${error.message}`);
  }

  return data ?? [];
}
