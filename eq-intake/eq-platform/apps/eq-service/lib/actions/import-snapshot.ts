'use server'

/**
 * Pre-import snapshot helper.
 *
 * Generalises the pre-wipe snapshot pattern from
 * commitCommercialSheetAction (which captures the wiped contract_scopes
 * rows into audit_logs.metadata.pre_wipe_snapshot). Lets any importer
 * record the "before" state of the rows it is about to overwrite, so a
 * bad batch can be audit-recovered without resorting to a backup ZIP.
 *
 * Pattern:
 *
 *   const snapshot = await captureImportSnapshot({
 *     supabase,
 *     entityType: 'acb_test',
 *     ids: testIdsAboutToUpdate,
 *     columns: 'id, brand, breaker_type, cb_serial, ...',
 *   })
 *
 *   // ... do the import ...
 *
 *   await logAuditEvent({
 *     action: 'import',
 *     entityType: 'acb_test',
 *     summary: `ACB collection import: ${n} updated`,
 *     metadata: {
 *       pre_import_snapshot: snapshot.rows,
 *       snapshot_captured_at: snapshot.capturedAt,
 *       ...
 *     },
 *     mutationId,
 *   })
 *
 * The snapshot lives in jsonb on `audit_logs.metadata`. Postgres jsonb
 * is fine for the sizes we expect (a 200-row ACB batch is ~80 KB of
 * JSON); above ~2000 rows you should be wiping-and-replacing via an
 * RPC like commit_commercial_sheet does, where the snapshot can stay
 * server-side.
 *
 * Future: /admin/imports surfaces a "snapshot available — revert" chip
 * when a row in the audit-log table has metadata.pre_import_snapshot
 * populated. The revert UI itself is per-entity and lives outside this
 * helper.
 *
 * Adoption status (2026-05-21):
 *   ✓ commercial-sheet — server-side via wipe_and_replace_contract_scopes RPC
 *   ☐ ACB collection import — wired post PR #180 merge to avoid file conflict
 *   ☐ Delta WO — inserts only, no overwrite, snapshot not applicable
 *   ☐ RCD Jemena — finds-or-creates, snapshot not applicable
 *   ☐ Scope CSV — inserts only, snapshot not applicable
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ImportSnapshot {
  capturedAt: string
  entityType: string
  rowCount: number
  rows: Array<Record<string, unknown>>
}

export interface CaptureSnapshotOptions {
  supabase: SupabaseClient
  /** The DB table name, e.g. "acb_tests" or "check_assets". */
  entityType: string
  /** Row IDs about to be updated/deleted. */
  ids: string[]
  /** Comma-separated select list — keep narrow to bound the audit row size. */
  columns: string
  /**
   * Soft cap. If the input array is larger, no snapshot is taken and
   * the caller should fall back to "ask for a backup before this
   * operation" UX. Default 2000 — well above any realistic ACB /
   * scope-CSV batch, low enough to keep audit_logs.metadata sane.
   */
  maxRows?: number
}

export async function captureImportSnapshot(
  opts: CaptureSnapshotOptions,
): Promise<ImportSnapshot | null> {
  const { supabase, entityType, ids, columns } = opts
  const maxRows = opts.maxRows ?? 2000
  if (ids.length === 0) {
    return {
      capturedAt: new Date().toISOString(),
      entityType,
      rowCount: 0,
      rows: [],
    }
  }
  if (ids.length > maxRows) return null

  const { data, error } = await supabase
    .from(entityType)
    .select(columns)
    .in('id', ids)
  if (error) {
    // Snapshot failure must not block the import — the caller has its
    // own audit log. Return null and let the caller decide whether to
    // proceed without a snapshot.
    return null
  }
  const rows = Array.isArray(data)
    ? (data as unknown as Array<Record<string, unknown>>)
    : []
  return {
    capturedAt: new Date().toISOString(),
    entityType,
    rowCount: rows.length,
    rows,
  }
}
