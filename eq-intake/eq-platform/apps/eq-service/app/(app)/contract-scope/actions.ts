'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { ContractScopePeriodStatus } from '@/lib/types'

export async function createScopeItemAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const customer_id = formData.get('customer_id') as string
    const site_id = (formData.get('site_id') as string) || null
    const financial_year = (formData.get('financial_year') as string) || '2025-2026'
    const scope_item = (formData.get('scope_item') as string)?.trim()
    const is_included = formData.get('is_included') === 'true'
    const notes = (formData.get('notes') as string)?.trim() || null

    if (!customer_id) return { success: false, error: 'Customer is required.' }
    if (!scope_item) return { success: false, error: 'Scope item is required.' }

    const { error } = await supabase
      .from('contract_scopes')
      .insert({ tenant_id: tenantId, customer_id, site_id, financial_year, scope_item, is_included, notes })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'contract_scope', summary: `Added scope item "${scope_item}" for FY ${financial_year}` })
    revalidatePath('/contract-scope')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateScopeItemAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const customer_id = formData.get('customer_id') as string
    const site_id = (formData.get('site_id') as string) || null
    const financial_year = (formData.get('financial_year') as string) || '2025-2026'
    const scope_item = (formData.get('scope_item') as string)?.trim()
    const is_included = formData.get('is_included') === 'true'
    const notes = (formData.get('notes') as string)?.trim() || null

    if (!scope_item) return { success: false, error: 'Scope item is required.' }

    const { error } = await supabase
      .from('contract_scopes')
      .update({ customer_id, site_id, financial_year, scope_item, is_included, notes })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'contract_scope', entityId: id, summary: `Updated scope item "${scope_item}"` })
    revalidatePath('/contract-scope')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export interface ScopeImportRowResult {
  /** 1-based row number from the CSV the user uploaded. */
  rowNumber: number
  customer: string
  site: string | null
  scope_item: string
  ok: boolean
  reason?: string
}

export async function importScopeItemsAction(items: {
  customer_name: string
  site_name: string | null
  financial_year: string
  scope_item: string
  is_included: boolean
  notes: string | null
}[]) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    // Build lookup maps for customers and sites
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name')
      .eq('is_active', true)
    const custMap: Record<string, string> = {}
    for (const c of customers ?? []) custMap[c.name.toLowerCase()] = c.id

    const { data: sites } = await supabase
      .from('sites')
      .select('id, name')
      .eq('is_active', true)
    const siteMap: Record<string, string> = {}
    for (const s of sites ?? []) siteMap[s.name.toLowerCase()] = s.id

    let imported = 0
    let skipped = 0
    // Per-row results — replaces the old "imported / skipped" counts so
    // the UI can show exactly which rows failed and why. The order
    // matches the input array so callers can map rowNumber = idx + 2
    // (row 1 = CSV header).
    const rowResults: ScopeImportRowResult[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      const rowNumber = i + 2
      const customerId = custMap[item.customer_name.toLowerCase()]
      if (!customerId) {
        skipped++
        rowResults.push({
          rowNumber,
          customer: item.customer_name,
          site: item.site_name,
          scope_item: item.scope_item,
          ok: false,
          reason: `Customer "${item.customer_name}" not found in this workspace.`,
        })
        continue
      }
      const siteId = item.site_name ? (siteMap[item.site_name.toLowerCase()] ?? null) : null
      if (item.site_name && !siteId) {
        // Site name supplied but no match — note it as a soft issue so
        // the user can fix the typo. We still insert the row at customer
        // level (site_id = null) to preserve prior behaviour where a
        // missing site quietly became customer-level, but flag it.
        rowResults.push({
          rowNumber,
          customer: item.customer_name,
          site: item.site_name,
          scope_item: item.scope_item,
          ok: false,
          reason: `Site "${item.site_name}" not found — inserted at customer level. Fix the site name and re-import to attach.`,
        })
        // Note: not skipping the insert here intentionally — see comment above.
      }

      const { error } = await supabase
        .from('contract_scopes')
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          site_id: siteId,
          financial_year: item.financial_year || '2025-2026',
          scope_item: item.scope_item,
          is_included: item.is_included,
          notes: item.notes,
        })

      if (error) {
        skipped++
        rowResults.push({
          rowNumber,
          customer: item.customer_name,
          site: item.site_name,
          scope_item: item.scope_item,
          ok: false,
          reason: error.message,
        })
        continue
      }
      imported++
      // Only push a success row if we haven't already pushed a soft-fail row above
      if (!(item.site_name && !siteId)) {
        rowResults.push({
          rowNumber,
          customer: item.customer_name,
          site: item.site_name,
          scope_item: item.scope_item,
          ok: true,
        })
      }
    }

    // Emit plain-string rowErrors for the shared ImportCSVModal contract,
    // and structured rowResults for any caller that wants full detail.
    const rowErrors = rowResults
      .filter((r) => !r.ok)
      .map((r) => `Row ${r.rowNumber}: ${r.customer}${r.site ? ` / ${r.site}` : ''} — ${r.reason ?? 'Unknown error'}`)

    await logAuditEvent({
      action: 'import',
      entityType: 'contract_scope',
      summary: `Scope import: ${imported} imported, ${skipped} skipped, ${rowErrors.length} row issues`,
      metadata: { imported, skipped, total: items.length },
    })
    revalidatePath('/contract-scope')
    return { success: true as const, imported, skipped, rowResults, rowErrors }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}

/**
 * Phase 5 of the contract-scope bridge plan — period_status transition
 * action. Used by the lock/unlock/archive controls on /contract-scope.
 *
 * - Admin role required (super_admin can do everything; admin can flip
 *   draft⇄committed and committed→locked. Only super_admin bypasses the
 *   DB-level lock-gate trigger when going locked→anything else, so for
 *   non-super_admin we early-out before issuing the UPDATE rather than
 *   relying on the trigger to raise.)
 * - Surfaces the new status + reason into audit_logs.metadata so the
 *   history viewer can correlate.
 * - Server action is a no-op gate when the tenant doesn't have the
 *   commercial-tier feature enabled — the DB trigger short-circuits in
 *   that case anyway, but we want a clean error message instead of an
 *   ineffective UPDATE.
 */
export async function setContractScopePeriodStatusAction(
  id: string,
  newStatus: 'draft' | 'committed' | 'locked' | 'archived',
  reason: string | null,
) {
  try {
    const { supabase, role, tenantId } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin role required to change scope status.' }

    // Read current row + tenant flag in parallel.
    const [scopeRes, settingsRes] = await Promise.all([
      supabase
        .from('contract_scopes')
        .select('id, period_status, scope_item, financial_year')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('tenant_settings')
        .select('commercial_features_enabled')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ])
    if (scopeRes.error || !scopeRes.data) {
      return { success: false, error: scopeRes.error?.message ?? 'Scope item not found.' }
    }
    if (!settingsRes.data?.commercial_features_enabled) {
      return { success: false, error: 'Period locking is a commercial-tier feature. Enable it in Admin → Settings first.' }
    }

    const oldStatus = scopeRes.data.period_status as 'draft' | 'committed' | 'locked' | 'archived'
    if (oldStatus === newStatus) return { success: true } // no-op

    // App-layer guard for non-super_admin trying to leave 'locked' state —
    // the DB trigger will block, but we'd rather not issue a doomed UPDATE.
    if (oldStatus === 'locked' && role !== 'super_admin') {
      return { success: false, error: 'Only super_admin can unlock a locked period. Contact your system owner.' }
    }

    const { error } = await supabase
      .from('contract_scopes')
      .update({ period_status: newStatus })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'contract_scope',
      entityId: id,
      summary: `${oldStatus} → ${newStatus}: ${scopeRes.data.scope_item} (FY ${scopeRes.data.financial_year})`,
      metadata: {
        period_status_old: oldStatus,
        period_status_new: newStatus,
        reason: reason ?? null,
      },
    })
    revalidatePath('/contract-scope')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteScopeItemAction(id: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('contract_scopes')
      .delete()
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'contract_scope', entityId: id, summary: 'Deleted scope item' })
    revalidatePath('/contract-scope')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
