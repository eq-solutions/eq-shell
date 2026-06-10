'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'

type EntityTable = 'customers' | 'sites' | 'assets' | 'job_plans' | 'instruments' | 'maintenance_checks'

const TABLE_CONFIG: Record<EntityTable, { path: string; label: string; softDeleteField: string }> = {
  customers: { path: '/customers', label: 'customer', softDeleteField: 'is_active' },
  sites: { path: '/sites', label: 'site', softDeleteField: 'is_active' },
  assets: { path: '/assets', label: 'asset', softDeleteField: 'is_active' },
  job_plans: { path: '/job-plans', label: 'job plan', softDeleteField: 'is_active' },
  instruments: { path: '/instruments', label: 'instrument', softDeleteField: 'status' },
  maintenance_checks: { path: '/maintenance', label: 'maintenance check', softDeleteField: 'status' },
}

export async function bulkDeactivateAction(table: EntityTable, ids: string[]) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }
    if (ids.length === 0) return { success: false, error: 'No items selected.' }
    if (ids.length > 200) return { success: false, error: 'Maximum 200 items per bulk action.' }

    const config = TABLE_CONFIG[table]
    if (!config) return { success: false, error: 'Invalid entity type.' }

    let error
    if (table === 'instruments') {
      // Instruments use status = 'Retired' instead of is_active = false
      ;({ error } = await supabase.from(table).update({ status: 'Retired' }).in('id', ids))
    } else if (table === 'maintenance_checks') {
      // Maintenance checks use status = 'cancelled'
      ;({ error } = await supabase.from(table).update({ status: 'cancelled' }).in('id', ids))
    } else {
      ;({ error } = await supabase.from(table).update({ is_active: false }).in('id', ids))
    }

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: config.label.replace(' ', '_'),
      summary: `Bulk deactivated ${ids.length} ${config.label}${ids.length > 1 ? 's' : ''}`,
    })
    revalidatePath(config.path)
    if (table === 'maintenance_checks') {
      revalidatePath('/testing/summary')
      revalidatePath('/dashboard')
      revalidatePath('/analytics')
      revalidatePath('/reports')
      revalidatePath('/sites', 'layout')
    }
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function bulkDeleteAction(table: EntityTable, ids: string[]) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }
    if (ids.length === 0) return { success: false, error: 'No items selected.' }
    if (ids.length > 200) return { success: false, error: 'Maximum 200 items per bulk action.' }

    const config = TABLE_CONFIG[table]
    if (!config) return { success: false, error: 'Invalid entity type.' }

    // Cascade delete child records for entities with dependencies
    if (table === 'job_plans') {
      // Block delete if any assets are linked — user should deactivate or reassign assets first
      const { count: linkedAssets } = await supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .in('job_plan_id', ids)
      if (linkedAssets && linkedAssets > 0) {
        return {
          success: false,
          error: `Cannot delete — ${linkedAssets} asset${linkedAssets > 1 ? 's are' : ' is'} still linked to ${ids.length > 1 ? 'these job plans' : 'this job plan'}. Reassign the assets or use Deactivate instead.`,
        }
      }
      // Block delete if maintenance checks exist
      const { count: linkedChecks } = await supabase
        .from('maintenance_checks')
        .select('id', { count: 'exact', head: true })
        .in('job_plan_id', ids)
      if (linkedChecks && linkedChecks > 0) {
        return {
          success: false,
          error: `Cannot delete — ${linkedChecks} maintenance check${linkedChecks > 1 ? 's are' : ' is'} linked to ${ids.length > 1 ? 'these job plans' : 'this job plan'}. Use Deactivate instead to preserve history.`,
        }
      }
      // Safe to delete — only job plan items remain as children
      await supabase.from('job_plan_items').delete().in('job_plan_id', ids)
    } else if (table === 'sites') {
      // Block delete if sites have assets, job plans, or maintenance history
      const { count: siteAssets } = await supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .in('site_id', ids)
      if (siteAssets && siteAssets > 0) {
        return {
          success: false,
          error: `Cannot delete — ${siteAssets} asset${siteAssets > 1 ? 's are' : ' is'} at ${ids.length > 1 ? 'these sites' : 'this site'}. Use Deactivate instead to preserve history.`,
        }
      }
      // Safe — clean up any empty job plans at these sites
      const { data: siteJPs } = await supabase.from('job_plans').select('id').in('site_id', ids)
      const jpIds = (siteJPs ?? []).map((j) => j.id)
      if (jpIds.length > 0) {
        await supabase.from('job_plan_items').delete().in('job_plan_id', jpIds)
        await supabase.from('job_plans').delete().in('id', jpIds)
      }
    } else if (table === 'customers') {
      // Unlink sites from these customers (don't delete sites)
      await supabase.from('sites').update({ customer_id: null }).in('customer_id', ids)
    } else if (table === 'maintenance_checks') {
      // Delete check items first
      await supabase.from('maintenance_check_items').delete().in('check_id', ids)
    }

    const { error } = await supabase.from(table).delete().in('id', ids)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'delete',
      entityType: config.label.replace(' ', '_'),
      summary: `Permanently deleted ${ids.length} ${config.label}${ids.length > 1 ? 's' : ''}`,
    })
    revalidatePath(config.path)
    if (table === 'maintenance_checks') {
      revalidatePath('/testing/summary')
      revalidatePath('/dashboard')
      revalidatePath('/analytics')
      revalidatePath('/reports')
      revalidatePath('/sites', 'layout')
    }
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
