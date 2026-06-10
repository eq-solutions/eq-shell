'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite, canCreateCheck, canDoTestWork } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency } from '@/lib/actions/idempotency'
import type { TestingCheckType } from '@/lib/types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Creates a testing check and batch-creates test records for each selected asset.
 * Name is auto-generated: "{Site} {Frequency} {JobPlanCode} {Month} {Year}"
 *
 * Idempotent when called with a mutationId — bulk-creating N test records
 * across the asset list is the exact "I clicked retry on a flaky network"
 * scenario where duplicate writes could land. (B4 — 2026-04-27.)
 */
export async function createTestingCheckAction(input: {
  site_id: string
  job_plan_id: string | null
  check_type: TestingCheckType
  frequency: string
  month: number
  year: number
  asset_ids: string[]
  notes?: string
}, mutationId?: string) {
  return withIdempotency(mutationId, async () => {
    const { supabase, tenantId, user, role } = await requireUser()
    // Tech-on-site creating a kind=acb/nsx/general check — mirrors the
    // canCreateCheck gate used by maintenance/createCheckAction (migration
    // 0080 includes technician in the RLS write list). Without this,
    // techs reach the Create Check UI but the action rejects them.
    if (!canCreateCheck(role)) return { success: false, error: 'Insufficient permissions.' }

    if (!input.site_id) return { success: false, error: 'Site is required.' }
    if (!input.asset_ids.length) return { success: false, error: 'Select at least one asset.' }
    if (!input.frequency) return { success: false, error: 'Frequency is required.' }
    if (!input.month || input.month < 1 || input.month > 12) return { success: false, error: 'Valid month is required.' }
    if (!input.year) return { success: false, error: 'Year is required.' }

    // Get site name for check name
    const { data: site } = await supabase
      .from('sites')
      .select('name')
      .eq('id', input.site_id)
      .maybeSingle()

    // Get maintenance plan code for check name
    let jpCode = ''
    if (input.job_plan_id) {
      const { data: jp } = await supabase
        .from('job_plans')
        .select('name, code')
        .eq('id', input.job_plan_id)
        .maybeSingle()
      jpCode = jp?.code || jp?.name || ''
    }

    const checkName = [
      site?.name ?? 'Site',
      input.frequency,
      jpCode,
      MONTH_NAMES[input.month - 1],
      String(input.year),
    ].filter(Boolean).join(' ')

    // Create the maintenance check (post-merge — testing_checks merged into
    // maintenance_checks in migration 0080). Stamp `kind` so the row is
    // queryable as a test-bench check; date columns derived from month/year.
    const monthDate = new Date(input.year, input.month - 1, 1).toISOString().slice(0, 10)
    const { data: check, error: checkErr } = await supabase
      .from('maintenance_checks')
      .insert({
        tenant_id: tenantId,
        site_id: input.site_id,
        job_plan_id: input.job_plan_id,
        custom_name: checkName,
        kind: input.check_type,
        frequency: input.frequency,
        start_date: monthDate,
        due_date: monthDate,
        status: 'scheduled',
        created_by: user.id,
        notes: input.notes || null,
      })
      .select('id')
      .single()

    if (checkErr || !check) return { success: false, error: checkErr?.message ?? 'Failed to create check.' }

    // Batch-create test records for each asset
    const testDate = new Date().toISOString().slice(0, 10)

    if (input.check_type === 'acb') {
      const rows = input.asset_ids.map((assetId) => ({
        tenant_id: tenantId,
        asset_id: assetId,
        site_id: input.site_id,
        check_id: check.id,
        test_date: testDate,
        test_type: 'Routine' as const,
        overall_result: 'Pending' as const,
      }))

      const { error: insertErr } = await supabase
        .from('acb_tests')
        .insert(rows)

      if (insertErr) return { success: false, error: insertErr.message }
    } else if (input.check_type === 'nsx') {
      const rows = input.asset_ids.map((assetId) => ({
        tenant_id: tenantId,
        asset_id: assetId,
        site_id: input.site_id,
        check_id: check.id,
        test_date: testDate,
        test_type: 'Routine' as const,
        overall_result: 'Pending' as const,
      }))

      const { error: insertErr } = await supabase
        .from('nsx_tests')
        .insert(rows)

      if (insertErr) return { success: false, error: insertErr.message }
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      entityId: check.id,
      summary: `Created ${input.check_type.toUpperCase()} check "${checkName}" with ${input.asset_ids.length} assets`,
      mutationId,
    })

    revalidatePath('/testing')
    revalidatePath('/testing/summary')
    revalidatePath('/testing/acb')
    revalidatePath('/maintenance')
    return { success: true, data: { checkId: check.id, checkName } }
  })
}

/**
 * Archive a testing check (soft delete via is_active=false).
 * The set_deleted_at trigger from migration 0035 stamps deleted_at,
 * starting the auto-purge countdown. Restorable from /admin/archive
 * inside the grace window.
 *
 * Post-merge: writes to maintenance_checks (rows with kind in acb/nsx/general).
 */
export async function archiveTestingCheckAction(checkId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const { data: existing, error: fetchErr } = await supabase
      .from('maintenance_checks')
      .select('id, custom_name, kind')
      .eq('id', checkId)
      .maybeSingle()
    if (fetchErr) return { success: false, error: fetchErr.message }
    if (!existing) return { success: false, error: 'Check not found.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ is_active: false })
      .eq('id', checkId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'delete',
      entityType: 'maintenance_check',
      entityId: checkId,
      summary: `Archived ${(existing.kind ?? 'maintenance').toUpperCase()} check "${existing.custom_name ?? checkId}"`,
    })

    revalidatePath('/testing/summary')
    revalidatePath('/admin/archive')
    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update status of a testing check (e.g. mark complete, cancel).
 *
 * Post-merge: writes to maintenance_checks (rows with kind in acb/nsx/general).
 */
export async function updateTestingCheckStatusAction(checkId: string, status: string) {
  try {
    const { supabase, role } = await requireUser()
    // Tech-on-site marking their test complete — mirrors propagateCheck-
    // CompletionIfReady which already flips kind=acb/nsx parent checks
    // when the per-test workflow finishes. Without this gate the UI's
    // "Mark Complete" button on a kind=acb/nsx check would fail for techs.
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status })
      .eq('id', checkId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check',
      entityId: checkId,
      summary: `Updated check status to ${status}`,
    })

    revalidatePath('/testing/summary')
    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
