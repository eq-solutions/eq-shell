'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'

/**
 * Wipe contract data for one customer in one financial year.
 *
 * Deletes (in this order):
 *   1. scope_coverage_gaps   (customer_id + contract_year)
 *   2. pm_calendar           (site_id IN customer's sites; year by start_time
 *                             OR null start_time + financial_year text match)
 *   3. contract_scopes       (customer_id + financial_year text match)
 *
 * Sites, assets and the customer row itself are untouched. This is the
 * "before reimport" preparation step — the importer can then INSERT a
 * clean year of contract data without colliding with stale rows.
 *
 * Admin only. Requires the user to type the customer's name to confirm,
 * matching the pattern used by /admin/archive's hard-delete flow.
 */
export async function wipeCustomerContractDataAction(formData: FormData) {
  const parsed = z
    .object({
      customer_id: z.string().uuid(),
      financial_year: z.string().regex(/^\d{4}$/, 'Year must be YYYY.'),
      confirm_name: z.string().min(1),
    })
    .safeParse({
      customer_id: formData.get('customer_id'),
      financial_year: formData.get('financial_year'),
      confirm_name: formData.get('confirm_name'),
    })

  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) {
    return { ok: false as const, error: 'Not authorised.' }
  }

  // Tenant-scoped fetch + name match
  const { data: customer, error: fetchErr } = await supabase
    .from('customers')
    .select('id, name, tenant_id')
    .eq('id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (fetchErr) return { ok: false as const, error: fetchErr.message }
  if (!customer) return { ok: false as const, error: 'Customer not found.' }
  if ((customer.name ?? '').trim() !== parsed.data.confirm_name.trim()) {
    return { ok: false as const, error: 'Confirmation name did not match.' }
  }

  const year = parseInt(parsed.data.financial_year, 10)
  const yearText = String(year)

  // Site IDs scoped to this customer + tenant. Used to bound the pm_calendar
  // delete (pm_calendar has no customer_id column, only site_id).
  const { data: sites, error: sitesErr } = await supabase
    .from('sites')
    .select('id')
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
  if (sitesErr) return { ok: false as const, error: sitesErr.message }
  const siteIds = (sites ?? []).map((s) => s.id as string)

  // 1. Coverage gaps (cascade-deleted by contract_scopes anyway, but explicit
  //    so the count we report is accurate).
  const { data: gapsDel, error: gapsErr } = await supabase
    .from('scope_coverage_gaps')
    .delete()
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
    .eq('contract_year', year)
    .select('id')
  if (gapsErr) return { ok: false as const, error: `Gaps: ${gapsErr.message}` }
  const gapsCount = (gapsDel ?? []).length

  // 2. Calendar rows for this year (dated rows) and the null-start
  //    end-of-year management entries (matched by financial_year text).
  let calendarCount = 0
  if (siteIds.length > 0) {
    const yearStart = `${yearText}-01-01`
    const yearEnd = `${year + 1}-01-01`
    const { data: cal1, error: cal1Err } = await supabase
      .from('pm_calendar')
      .delete()
      .in('site_id', siteIds)
      .eq('tenant_id', tenantId)
      .gte('start_time', yearStart)
      .lt('start_time', yearEnd)
      .select('id')
    if (cal1Err) return { ok: false as const, error: `Calendar (dated): ${cal1Err.message}` }
    const { data: cal2, error: cal2Err } = await supabase
      .from('pm_calendar')
      .delete()
      .in('site_id', siteIds)
      .eq('tenant_id', tenantId)
      .is('start_time', null)
      .eq('financial_year', yearText)
      .select('id')
    if (cal2Err) return { ok: false as const, error: `Calendar (null-start): ${cal2Err.message}` }
    calendarCount = (cal1 ?? []).length + (cal2 ?? []).length
  }

  // 3. Contract scopes
  const { data: scopeDel, error: scopeErr } = await supabase
    .from('contract_scopes')
    .delete()
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
    .eq('financial_year', yearText)
    .select('id')
  if (scopeErr) return { ok: false as const, error: `Scopes: ${scopeErr.message}` }
  const scopeCount = (scopeDel ?? []).length

  await logAuditEvent({
    action: 'delete',
    entityType: 'customer',
    entityId: customer.id,
    summary: `Wiped ${yearText} contract data for ${customer.name}: ${scopeCount} scope rows, ${calendarCount} calendar rows, ${gapsCount} coverage gaps`,
    metadata: {
      wipe_kind: 'contract_data',
      year,
      scope_count: scopeCount,
      calendar_count: calendarCount,
      gap_count: gapsCount,
    },
  })

  revalidatePath(`/customers/${customer.id}`)
  revalidatePath('/contract-scope')
  revalidatePath('/calendar')
  revalidatePath('/reports')
  revalidatePath('/dashboard')

  return {
    ok: true as const,
    counts: { scopes: scopeCount, calendar: calendarCount, gaps: gapsCount },
  }
}

/**
 * Preview (dry-run): returns the counts that would be wiped without
 * actually deleting. Used by the danger-zone modal so the user can see
 * the blast radius before typing the confirm name.
 */
export async function previewCustomerContractDataWipeAction(formData: FormData) {
  const parsed = z
    .object({
      customer_id: z.string().uuid(),
      financial_year: z.string().regex(/^\d{4}$/, 'Year must be YYYY.'),
    })
    .safeParse({
      customer_id: formData.get('customer_id'),
      financial_year: formData.get('financial_year'),
    })
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false as const, error: 'Not authorised.' }

  const year = parseInt(parsed.data.financial_year, 10)
  const yearText = String(year)

  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
  const siteIds = (sites ?? []).map((s) => s.id as string)

  const [scopes, gaps, calDated, calNull] = await Promise.all([
    supabase
      .from('contract_scopes')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', parsed.data.customer_id)
      .eq('tenant_id', tenantId)
      .eq('financial_year', yearText),
    supabase
      .from('scope_coverage_gaps')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', parsed.data.customer_id)
      .eq('tenant_id', tenantId)
      .eq('contract_year', year),
    siteIds.length > 0
      ? supabase
          .from('pm_calendar')
          .select('id', { count: 'exact', head: true })
          .in('site_id', siteIds)
          .eq('tenant_id', tenantId)
          .gte('start_time', `${yearText}-01-01`)
          .lt('start_time', `${year + 1}-01-01`)
      : Promise.resolve({ count: 0 } as { count: number | null }),
    siteIds.length > 0
      ? supabase
          .from('pm_calendar')
          .select('id', { count: 'exact', head: true })
          .in('site_id', siteIds)
          .eq('tenant_id', tenantId)
          .is('start_time', null)
          .eq('financial_year', yearText)
      : Promise.resolve({ count: 0 } as { count: number | null }),
  ])

  return {
    ok: true as const,
    counts: {
      scopes: scopes.count ?? 0,
      calendar: (calDated.count ?? 0) + (calNull.count ?? 0),
      gaps: gaps.count ?? 0,
    },
  }
}
