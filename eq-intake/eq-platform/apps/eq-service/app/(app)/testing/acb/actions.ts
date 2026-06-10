'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canDoTestWork } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency } from '@/lib/actions/idempotency'
import { CreateAcbTestSchema, UpdateAcbTestSchema, CreateAcbReadingSchema } from '@/lib/validations/acb-test'
import { propagateCheckCompletionIfReady } from '@/lib/actions/check-completion'
import { notifyDefectRaised } from '@/lib/actions/defect-notifications'
import { mirrorBreakerColumns } from '@/lib/utils/breaker-cols'
import { z } from 'zod'

// Parser ships AcbImportRowSchema separately to avoid pulling exceljs into
// the server bundle. Re-declare the shape here (server-side trust boundary).
const AcbImportRowServerSchema = z.object({
  asset_id: z.string().uuid(),
  test_id: z.string().uuid(),
  brand: z.string().max(200).nullable().optional(),
  breaker_type: z.string().max(200).nullable().optional(),
  name_location: z.string().max(200).nullable().optional(),
  cb_serial: z.string().max(200).nullable().optional(),
  performance_level: z.string().max(200).nullable().optional(),
  protection_unit_fitted: z.boolean().nullable().optional(),
  trip_unit_model: z.string().max(200).nullable().optional(),
  cb_poles: z.string().max(200).nullable().optional(),
  current_in: z.string().max(200).nullable().optional(),
  fixed_withdrawable: z.string().max(200).nullable().optional(),
  long_time_ir: z.string().max(200).nullable().optional(),
  long_time_delay_tr: z.string().max(200).nullable().optional(),
  short_time_pickup_isd: z.string().max(200).nullable().optional(),
  short_time_delay_tsd: z.string().max(200).nullable().optional(),
  instantaneous_pickup: z.string().max(200).nullable().optional(),
  earth_fault_pickup: z.string().max(200).nullable().optional(),
  earth_fault_delay: z.string().max(200).nullable().optional(),
  earth_leakage_pickup: z.string().max(200).nullable().optional(),
  earth_leakage_delay: z.string().max(200).nullable().optional(),
  motor_charge: z.string().max(200).nullable().optional(),
  shunt_trip_mx1: z.string().max(200).nullable().optional(),
  shunt_close_xf: z.string().max(200).nullable().optional(),
  undervoltage_mn: z.string().max(200).nullable().optional(),
  second_shunt_trip: z.string().max(200).nullable().optional(),
})

const ImportPayloadSchema = z.object({
  rows: z.array(
    AcbImportRowServerSchema.extend({
      rowNumber: z.number().int().min(1),
      assetName: z.string().optional().nullable(),
    }),
  ).max(2000, 'Too many rows in a single import — split the file.'),
  mutationId: z.string().optional().nullable(),
})

export type AcbImportPayload = z.infer<typeof ImportPayloadSchema>

export async function createAcbTestAction(formData: FormData) {
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
      trip_settings_ir: formData.get('trip_settings_ir') || null,
      trip_settings_isd: formData.get('trip_settings_isd') || null,
      trip_settings_ii: formData.get('trip_settings_ii') || null,
      trip_settings_ig: formData.get('trip_settings_ig') || null,
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = CreateAcbTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    // Sprint 1 schema unification (Refs #101): mirror legacy <-> new
    // breaker-identification columns so reads from either column set
    // surface the same value.
    const dualWrite = mirrorBreakerColumns(parsed.data)

    const { error } = await supabase
      .from('acb_tests')
      .insert({ ...dualWrite, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'acb_test', summary: 'Created ACB test record' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateAcbTestAction(id: string, formData: FormData) {
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
      trip_settings_ir: formData.get('trip_settings_ir') || null,
      trip_settings_isd: formData.get('trip_settings_isd') || null,
      trip_settings_ii: formData.get('trip_settings_ii') || null,
      trip_settings_ig: formData.get('trip_settings_ig') || null,
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = UpdateAcbTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    // Sprint 1 schema unification (Refs #101): see createAcbTestAction.
    const dualWrite = mirrorBreakerColumns(parsed.data)

    const { error } = await supabase
      .from('acb_tests')
      .update(dualWrite)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: id, summary: 'Updated ACB test record' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function toggleAcbTestActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    const { error } = await supabase
      .from('acb_tests')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'acb_test', entityId: id, summary: isActive ? 'Reactivated ACB test' : 'Deactivated ACB test' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function createAcbReadingAction(acbTestId: string, formData: FormData) {
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

    const parsed = CreateAcbReadingSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('acb_test_readings')
      .insert({ ...parsed.data, acb_test_id: acbTestId, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'acb_test_reading', summary: 'Added ACB test reading' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteAcbReadingAction(readingId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('acb_test_readings')
      .delete()
      .eq('id', readingId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'acb_test_reading', entityId: readingId, summary: 'Deleted ACB test reading' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateAcbDetailsAction(testId: string, data: {
  cb_make?: string | null
  cb_model?: string | null
  cb_serial?: string | null
  cb_rating?: string | null
  cb_poles?: string | null
  trip_unit?: string | null
  trip_settings_ir?: string | null
  trip_settings_isd?: string | null
  trip_settings_ii?: string | null
  trip_settings_ig?: string | null
  step1_status?: string
  // Asset Collection fields
  brand?: string | null
  breaker_type?: string | null
  name_location?: string | null
  performance_level?: string | null
  protection_unit_fitted?: boolean | null
  trip_unit_model?: string | null
  current_in?: string | null
  fixed_withdrawable?: string | null
  // Protection Settings
  long_time_ir?: string | null
  long_time_delay_tr?: string | null
  short_time_pickup_isd?: string | null
  short_time_delay_tsd?: string | null
  instantaneous_pickup?: string | null
  earth_fault_pickup?: string | null
  earth_fault_delay?: string | null
  earth_leakage_pickup?: string | null
  earth_leakage_delay?: string | null
  // Accessories
  motor_charge?: string | null
  shunt_trip_mx1?: string | null
  shunt_close_xf?: string | null
  undervoltage_mn?: string | null
  second_shunt_trip?: string | null
}) {
  try {
    const { supabase, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const updateData: Record<string, unknown> = {}
    for (const key of Object.keys(data)) {
      if (data[key as keyof typeof data] !== undefined) {
        updateData[key] = data[key as keyof typeof data]
      }
    }
    if (Object.keys(updateData).length === 0) {
      return { success: true }
    }

    // Sprint 1 schema unification (Refs #101): mirror legacy <-> new
    // breaker-identification columns. The 3-step workflow form writes
    // new (brand/breaker_type/current_in/trip_unit_model); the bulk-edit
    // form (AcbBulkDetails) writes legacy (cb_make/cb_model/cb_rating/
    // trip_unit). Either side reaching this action gets its sibling
    // populated so the report renders the same value via either read path.
    const dualWrite = mirrorBreakerColumns(updateData)

    const { error } = await supabase
      .from('acb_tests')
      .update(dualWrite)
      .eq('id', testId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: testId, summary: 'Updated ACB circuit breaker details' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export interface AcbImportRowResultServer {
  test_id: string
  rowNumber: number
  ok: boolean
  reason?: string
  assetName?: string
}

/**
 * Batch ACB collection import. Replaces the per-row client-side update
 * loop in /testing/acb. Surfaces per-row errors with row numbers and
 * plain-language reasons; tenant-scoped so a malicious payload can't
 * touch another tenant's tests; replay-safe when called with a
 * `mutationId` (offline queue / retry).
 *
 * Returns:
 *   { success: true, data: { updated, failed, rowResults } }
 *   { success: false, error }
 *
 * Atomicity caveat: each row's UPDATE is a separate statement. A failure
 * partway through leaves prior rows committed — the rowResults tell the
 * tech exactly which rows landed and which didn't, so a re-upload of the
 * failed-rows-only CSV cleans things up. A full RPC wrap (one
 * transaction) is the natural follow-up once the action proves stable.
 */
export async function importAcbCollectionAction(input: AcbImportPayload) {
  const parsed = ImportPayloadSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid import payload.' }
  }
  return withIdempotency(parsed.data.mutationId ?? null, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false as const, error: 'Insufficient permissions.' }

    const rows = parsed.data.rows
    if (rows.length === 0) {
      return { success: true as const, data: { updated: 0, failed: 0, rowResults: [] as AcbImportRowResultServer[] } }
    }

    // Tenant scoping: confirm every test_id in the payload belongs to this
    // tenant before we touch anything. RLS would block cross-tenant writes
    // too, but this gives a clean "row 47 references a test that isn't
    // yours" error instead of an opaque RLS denial.
    const testIds = Array.from(new Set(rows.map((r) => r.test_id)))
    const { data: ownership, error: ownershipError } = await supabase
      .from('acb_tests')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', testIds)
    if (ownershipError) {
      return { success: false as const, error: `Ownership check failed: ${ownershipError.message}` }
    }
    const ownedIds = new Set((ownership ?? []).map((r: { id: string }) => r.id))

    const rowResults: AcbImportRowResultServer[] = []
    let updated = 0
    let failed = 0
    for (const row of rows) {
      if (!ownedIds.has(row.test_id)) {
        rowResults.push({
          test_id: row.test_id,
          rowNumber: row.rowNumber,
          assetName: row.assetName ?? undefined,
          ok: false,
          reason: 'Test record not found in this workspace.',
        })
        failed++
        continue
      }

      const { rowNumber: _rn, assetName: _an, asset_id: _aid, test_id: _tid, ...fields } = row
      const updateData: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) updateData[k] = v
      }
      updateData.step1_status = 'complete'
      const dualWrite = mirrorBreakerColumns(updateData)

      const { error } = await supabase
        .from('acb_tests')
        .update(dualWrite)
        .eq('id', row.test_id)
        .eq('tenant_id', tenantId)

      if (error) {
        rowResults.push({
          test_id: row.test_id,
          rowNumber: row.rowNumber,
          assetName: row.assetName ?? undefined,
          ok: false,
          reason: error.message,
        })
        failed++
      } else {
        rowResults.push({
          test_id: row.test_id,
          rowNumber: row.rowNumber,
          assetName: row.assetName ?? undefined,
          ok: true,
        })
        updated++
      }
    }

    await logAuditEvent({
      action: 'import',
      entityType: 'acb_test',
      summary: `ACB collection import: ${updated} updated, ${failed} failed`,
      mutationId: parsed.data.mutationId ?? null,
      metadata: { updated, failed, total: rows.length },
    })
    revalidatePath('/testing/acb')

    return { success: true as const, data: { updated, failed, rowResults } }
  })
}

export async function saveAcbVisualCheckAction(testId: string, items: Array<{
  label: string
  result: 'pass' | 'fail' | 'na'
  comment?: string
}>) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    // Delete existing visual check readings for this test
    await supabase
      .from('acb_test_readings')
      .delete()
      .eq('acb_test_id', testId)
      .like('label', 'Visual Check:%')

    // Insert new readings
    const readings = items.map((item, idx) => ({
      acb_test_id: testId,
      tenant_id: tenantId,
      label: `Visual Check: ${item.label}`,
      value: item.comment || item.result.toUpperCase(),
      unit: null,
      is_pass: item.result === 'pass' ? true : item.result === 'fail' ? false : null,
      sort_order: idx,
    }))

    if (readings.length > 0) {
      const { error } = await supabase
        .from('acb_test_readings')
        .insert(readings)

      if (error) return { success: false, error: error.message }
    }

    // Update step2 status
    await supabase
      .from('acb_tests')
      .update({ step2_status: 'complete' })
      .eq('id', testId)

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: testId, summary: 'Completed ACB visual & functional test' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function saveAcbElectricalReadingAction(testId: string, readings: Array<{
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
      .from('acb_test_readings')
      .delete()
      .eq('acb_test_id', testId)
      .like('label', 'Electrical:%')

    // Insert new readings
    const insertReadings = readings.map((rdg, idx) => ({
      acb_test_id: testId,
      tenant_id: tenantId,
      label: `Electrical: ${rdg.label}`,
      value: rdg.value,
      unit: rdg.unit,
      is_pass: rdg.is_pass ?? null,
      sort_order: 100 + idx,
    }))

    if (insertReadings.length > 0) {
      const { error } = await supabase
        .from('acb_test_readings')
        .insert(insertReadings)

      if (error) return { success: false, error: error.message }
    }

    // Update step3 status
    await supabase
      .from('acb_tests')
      .update({ step3_status: 'complete' })
      .eq('id', testId)

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: testId, summary: 'Completed ACB electrical testing' })

    // Phase 4 (2026-04-28): when an ACB test reaches all-steps-complete,
    // check whether every other test under the linked maintenance_check
    // is also complete and propagate the parent status if so. Best-effort
    // — failures don't surface to the user.
    const { data: testRow } = await supabase
      .from('acb_tests')
      .select('check_id')
      .eq('id', testId)
      .maybeSingle()
    if (testRow?.check_id) {
      await propagateCheckCompletionIfReady(supabase, testRow.check_id)
    }

    revalidatePath('/testing/acb')
    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function raiseTestDefectAction(data: {
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

    await logAuditEvent({ action: 'create', entityType: 'defect', summary: `Raised defect from test: ${data.title}` })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
