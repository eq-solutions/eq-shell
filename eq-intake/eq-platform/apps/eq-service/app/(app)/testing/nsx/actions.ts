'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canDoTestWork } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { CreateNsxTestSchema, UpdateNsxTestSchema, CreateNsxReadingSchema } from '@/lib/validations/nsx-test'
import { propagateCheckCompletionIfReady } from '@/lib/actions/check-completion'
import { notifyDefectRaised } from '@/lib/actions/defect-notifications'
import { mirrorBreakerColumns } from '@/lib/utils/breaker-cols'

export async function createNsxTestAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      asset_id: formData.get('asset_id'),
      site_id: formData.get('site_id'),
      test_date: formData.get('test_date'),
      tested_by: formData.get('tested_by') || null,
      test_type: formData.get('test_type') || 'Routine',
      cb_make: formData.get('cb_make') || null,
      cb_model: formData.get('cb_model') || null,
      cb_serial: formData.get('cb_serial') || null,
      cb_rating: formData.get('cb_rating') || null,
      cb_poles: formData.get('cb_poles') || null,
      trip_unit: formData.get('trip_unit') || null,
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = CreateNsxTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    // Sprint 1 schema unification (Refs #101): mirror legacy <-> new
    // breaker-identification columns so reads from either column set
    // surface the same value.
    const dualWrite = mirrorBreakerColumns(parsed.data)

    const { error } = await supabase
      .from('nsx_tests')
      .insert({ ...dualWrite, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'nsx_test', summary: 'Created NSX test record' })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateNsxTestAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      asset_id: formData.get('asset_id'),
      site_id: formData.get('site_id'),
      test_date: formData.get('test_date'),
      tested_by: formData.get('tested_by') || null,
      test_type: formData.get('test_type') || 'Routine',
      cb_make: formData.get('cb_make') || null,
      cb_model: formData.get('cb_model') || null,
      cb_serial: formData.get('cb_serial') || null,
      cb_rating: formData.get('cb_rating') || null,
      cb_poles: formData.get('cb_poles') || null,
      trip_unit: formData.get('trip_unit') || null,
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = UpdateNsxTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    // Sprint 1 schema unification (Refs #101): see createNsxTestAction.
    const dualWrite = mirrorBreakerColumns(parsed.data)

    const { error } = await supabase
      .from('nsx_tests')
      .update(dualWrite)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'nsx_test', entityId: id, summary: 'Updated NSX test record' })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function toggleNsxTestActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    const { error } = await supabase
      .from('nsx_tests')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'nsx_test', entityId: id, summary: isActive ? 'Reactivated NSX test' : 'Deactivated NSX test' })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function createNsxReadingAction(nsxTestId: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      label: formData.get('label'),
      value: formData.get('value'),
      unit: formData.get('unit') || null,
      is_pass: formData.get('is_pass') === 'true' ? true : formData.get('is_pass') === 'false' ? false : null,
      sort_order: Number(formData.get('sort_order') ?? 0),
    }

    const parsed = CreateNsxReadingSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('nsx_test_readings')
      .insert({ ...parsed.data, nsx_test_id: nsxTestId, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'nsx_test_reading', summary: 'Added NSX test reading' })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update NSX test extended details (asset collection + step statuses).
 * Used by the 3-step workflow page at /testing/nsx (mirrors updateAcbDetailsAction).
 */
export async function updateNsxDetailsAction(
  testId: string,
  data: Partial<{
    step1_status: 'pending' | 'in_progress' | 'complete'
    step2_status: 'pending' | 'in_progress' | 'complete'
    step3_status: 'pending' | 'in_progress' | 'complete'
    brand: string | null
    breaker_type: string | null
    name_location: string | null
    current_in: string | null
    fixed_withdrawable: 'fixed' | 'withdrawable' | 'plug_in' | null
    protection_unit_fitted: boolean | null
    trip_unit_model: string | null
    long_time_ir: string | null
    long_time_delay_tr: string | null
    short_time_pickup_isd: string | null
    short_time_delay_tsd: string | null
    instantaneous_pickup: string | null
    earth_fault_pickup: string | null
    earth_fault_delay: string | null
    motor_charge: string | null
    shunt_trip_mx1: string | null
    shunt_close_xf: string | null
    undervoltage_mn: string | null
    cb_make: string | null
    cb_model: string | null
    cb_serial: string | null
    cb_rating: string | null
    cb_poles: string | null
    trip_unit: string | null
    notes: string | null
  }>,
) {
  try {
    const { supabase, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    // Sprint 1 schema unification (Refs #101): mirror legacy <-> new
    // breaker-identification columns. NsxWorkflow Step 1 writes the NEW
    // set (brand/breaker_type/current_in/trip_unit_model); legacy bulk
    // forms write the LEGACY set. Mirror so the customer report renders
    // the same value via either read path.
    const dualWrite = mirrorBreakerColumns(data as Record<string, unknown>)

    const { error } = await supabase
      .from('nsx_tests')
      .update(dualWrite)
      .eq('id', testId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'nsx_test',
      entityId: testId,
      summary: 'Updated NSX workflow details',
    })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Save the NSX Visual & Functional check as a batch of nsx_test_readings rows.
 * Mirrors saveAcbVisualCheckAction — replaces existing 'Visual Check:%' rows for
 * the test and marks step2_status = 'complete'.
 */
export async function saveNsxVisualCheckAction(testId: string, items: Array<{
  label: string
  result: 'pass' | 'fail' | 'na'
  comment?: string
}>) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    // Delete existing visual check readings for this test
    await supabase
      .from('nsx_test_readings')
      .delete()
      .eq('nsx_test_id', testId)
      .like('label', 'Visual Check:%')

    // Insert new readings
    const readings = items.map((item, idx) => ({
      nsx_test_id: testId,
      tenant_id: tenantId,
      label: `Visual Check: ${item.label}`,
      value: item.comment || item.result.toUpperCase(),
      unit: null,
      is_pass: item.result === 'pass' ? true : item.result === 'fail' ? false : null,
      sort_order: idx,
    }))

    if (readings.length > 0) {
      const { error } = await supabase
        .from('nsx_test_readings')
        .insert(readings)

      if (error) return { success: false, error: error.message }
    }

    // Update step2 status
    await supabase
      .from('nsx_tests')
      .update({ step2_status: 'complete' })
      .eq('id', testId)

    await logAuditEvent({
      action: 'update',
      entityType: 'nsx_test',
      entityId: testId,
      summary: 'Completed NSX visual & functional test',
    })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Save the NSX Electrical testing batch as 'Electrical:%' nsx_test_readings rows.
 * Mirrors saveAcbElectricalReadingAction.
 */
export async function saveNsxElectricalReadingAction(testId: string, readings: Array<{
  label: string
  value: string
  unit: string
  is_pass?: boolean
}>) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    // Delete existing electrical readings for this test
    await supabase
      .from('nsx_test_readings')
      .delete()
      .eq('nsx_test_id', testId)
      .like('label', 'Electrical:%')

    // Insert new readings
    const insertReadings = readings.map((rdg, idx) => ({
      nsx_test_id: testId,
      tenant_id: tenantId,
      label: `Electrical: ${rdg.label}`,
      value: rdg.value,
      unit: rdg.unit,
      is_pass: rdg.is_pass ?? null,
      sort_order: 100 + idx,
    }))

    if (insertReadings.length > 0) {
      const { error } = await supabase
        .from('nsx_test_readings')
        .insert(insertReadings)

      if (error) return { success: false, error: error.message }
    }

    // Update step3 status
    await supabase
      .from('nsx_tests')
      .update({ step3_status: 'complete' })
      .eq('id', testId)

    await logAuditEvent({
      action: 'update',
      entityType: 'nsx_test',
      entityId: testId,
      summary: 'Completed NSX electrical testing',
    })

    // Phase 4 (2026-04-28): propagate parent check completion if all
    // sibling tests are now done. Best-effort; failures are swallowed.
    const { data: testRow } = await supabase
      .from('nsx_tests')
      .select('check_id')
      .eq('id', testId)
      .maybeSingle()
    if (testRow?.check_id) {
      await propagateCheckCompletionIfReady(supabase, testRow.check_id)
    }

    revalidatePath('/testing/nsx')
    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Raise a defect from an NSX test failure. Mirrors raiseTestDefectAction in the
 * ACB actions file — kept NSX-local so the workflow component has a single
 * import path.
 */
export async function raiseNsxTestDefectAction(data: {
  asset_id: string
  site_id: string
  title: string
  description?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
}) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const { data: inserted, error } = await supabase
      .from('defects')
      .insert({
        tenant_id: tenantId,
        asset_id: data.asset_id,
        site_id: data.site_id,
        title: data.title,
        description: data.description || null,
        severity: data.severity || 'medium',
        status: 'open',
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }

    await notifyDefectRaised({
      tenantId,
      defectId: inserted.id,
      title: data.title,
      description: data.description ?? null,
      severity: data.severity || 'medium',
    })

    await logAuditEvent({
      action: 'create',
      entityType: 'defect',
      summary: `Raised defect from NSX test: ${data.title}`,
    })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteNsxReadingAction(readingId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('nsx_test_readings')
      .delete()
      .eq('id', readingId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'nsx_test_reading', entityId: readingId, summary: 'Deleted NSX test reading' })
    revalidatePath('/testing/nsx')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
