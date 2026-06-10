import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

type PublicTable = keyof Database['public']['Tables']

// ------------------------------------------------------------
// Entity types supported by the unified archive.
// Keep this array in one place so the page and actions agree.
// ------------------------------------------------------------
export const ARCHIVE_ENTITY_TYPES = [
  'customer',
  'site',
  'asset',
  'job_plan',
  'maintenance_check',
  'testing_check',
] as const

export type ArchiveEntityType = (typeof ARCHIVE_ENTITY_TYPES)[number]

/**
 * Display labels for each entity type, used by the tabs on
 * /admin/archive and by audit-log summaries.
 */
export const ARCHIVE_LABELS: Record<ArchiveEntityType, { singular: string; plural: string }> = {
  customer:          { singular: 'Customer',          plural: 'Customers' },
  site:              { singular: 'Site',              plural: 'Sites' },
  asset:             { singular: 'Asset',             plural: 'Assets' },
  job_plan:          { singular: 'Maintenance Plan',          plural: 'Maintenance Plans' },
  maintenance_check: { singular: 'Maintenance Check', plural: 'Maintenance Checks' },
  testing_check:     { singular: 'Testing Check',     plural: 'Testing Checks' },
}

/**
 * Maps our entity-type slug (used by the URL + audit logs) to the
 * actual Postgres table name. Keeps the table-name strings out of
 * every call site.
 */
export const TABLE_BY_ENTITY: Record<ArchiveEntityType, PublicTable> = {
  customer:          'customers',
  site:              'sites',
  asset:             'assets',
  job_plan:          'job_plans',
  maintenance_check: 'maintenance_checks',
  // Post-merge (migration 0080): testing_checks is a read-only view backed
  // by maintenance_checks where kind in (acb,nsx,general). Writes must
  // target the underlying table.
  testing_check:     'maintenance_checks',
}

// ------------------------------------------------------------
// Dependency counting — shared by the archive page (to decide
// whether to enable the Delete button) and the server action
// (to reject stale-UI bypass attempts).
//
// Typed loosely as `SupabaseClient` because the action file also
// calls this with a server client and TS infers the type fine.
// ------------------------------------------------------------
export async function countDependencies(
  supabase: SupabaseClient,
  entityType: ArchiveEntityType,
  entityId: string,
): Promise<number> {
  switch (entityType) {
    case 'customer': {
      const { count } = await supabase
        .from('sites')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', entityId)
      return count ?? 0
    }
    case 'site': {
      // Post-merge: testing_checks is now part of maintenance_checks
      // (kind in acb/nsx/general). The single mc count covers both.
      const [a, jp, mc] = await Promise.all([
        supabase.from('assets').select('*', { count: 'exact', head: true }).eq('site_id', entityId),
        supabase.from('job_plans').select('*', { count: 'exact', head: true }).eq('site_id', entityId),
        supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('site_id', entityId),
      ])
      return (a.count ?? 0) + (jp.count ?? 0) + (mc.count ?? 0)
    }
    case 'asset': {
      const [acb, nsx] = await Promise.all([
        supabase.from('acb_tests').select('*', { count: 'exact', head: true }).eq('asset_id', entityId),
        supabase.from('nsx_tests').select('*', { count: 'exact', head: true }).eq('asset_id', entityId),
      ])
      return (acb.count ?? 0) + (nsx.count ?? 0)
    }
    case 'job_plan': {
      const [a, mc] = await Promise.all([
        supabase.from('assets').select('*', { count: 'exact', head: true }).eq('job_plan_id', entityId),
        supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('job_plan_id', entityId),
      ])
      return (a.count ?? 0) + (mc.count ?? 0)
    }
    case 'maintenance_check':
      // maintenance_check_items cascade on delete — nothing blocks
      return 0
    case 'testing_check': {
      // acb_tests / nsx_tests use ON DELETE SET NULL so they don't
      // block the delete; count them anyway so Royce sees impact
      const [acb, nsx] = await Promise.all([
        supabase.from('acb_tests').select('*', { count: 'exact', head: true }).eq('check_id', entityId),
        supabase.from('nsx_tests').select('*', { count: 'exact', head: true }).eq('check_id', entityId),
      ])
      return (acb.count ?? 0) + (nsx.count ?? 0)
    }
  }
}

/**
 * Given a deleted_at timestamp and a grace-period window, returns
 * days remaining until auto-purge. Negative means overdue (cron
 * will catch it on next run). Null input = never auto-purges.
 */
export function daysUntilPurge(deletedAt: string | null, graceDays: number): number | null {
  if (!deletedAt) return null
  const deletedMs = new Date(deletedAt).getTime()
  const purgeMs = deletedMs + graceDays * 24 * 60 * 60 * 1000
  const remaining = purgeMs - Date.now()
  return Math.ceil(remaining / (24 * 60 * 60 * 1000))
}
