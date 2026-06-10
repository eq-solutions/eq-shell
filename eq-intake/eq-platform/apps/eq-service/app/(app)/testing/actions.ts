'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canDoTestWork, isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency } from '@/lib/actions/idempotency'
import {
  CreateTestRecordSchema,
  UpdateTestRecordSchema,
  CreateTestReadingSchema,
  UpdateTestReadingSchema,
} from '@/lib/validations/test-record'

/**
 * Create a test record. Idempotent when called with a mutationId — safe
 * to replay from a flaky-network jobsite tablet without inserting the
 * same record twice. (B4 idempotency adoption — 2026-04-27.)
 */
export async function createTestRecordAction(formData: FormData, mutationId?: string) {
  return withIdempotency(mutationId, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      asset_id: formData.get('asset_id'),
      site_id: formData.get('site_id'),
      test_type: formData.get('test_type'),
      test_date: formData.get('test_date'),
      tested_by: formData.get('tested_by') || null,
      result: formData.get('result') || 'pending',
      notes: formData.get('notes') || null,
      next_test_due: formData.get('next_test_due') || null,
    }

    const parsed = CreateTestRecordSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { data: record, error } = await supabase
      .from('test_records')
      .insert({ ...parsed.data, tenant_id: tenantId })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'create',
      entityType: 'test_record',
      summary: 'Created test record',
      mutationId,
    })

    revalidatePath('/testing')
    return { success: true, data: { recordId: record?.id } }
  })
}

export async function updateTestRecordAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw: Record<string, unknown> = {}
    for (const key of ['asset_id', 'site_id', 'test_type', 'test_date', 'tested_by', 'result', 'notes', 'next_test_due']) {
      if (formData.has(key)) raw[key] = formData.get(key) || null
    }

    const parsed = UpdateTestRecordSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('test_records')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'test_record', entityId: id, summary: 'Updated test record' })
    revalidatePath('/testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function toggleTestRecordActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('test_records')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'test_record', entityId: id, summary: isActive ? 'Reactivated test record' : 'Deactivated test record' })
    revalidatePath('/testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// --- Readings ---

/**
 * Create a test reading. Idempotent when called with a mutationId.
 * (B4 — 2026-04-27.)
 */
export async function createReadingAction(testRecordId: string, formData: FormData, mutationId?: string) {
  return withIdempotency(mutationId, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      label: formData.get('label'),
      value: formData.get('value') || null,
      unit: formData.get('unit') || null,
      pass: formData.get('pass') === '' ? null : formData.get('pass') === 'true',
      sort_order: Number(formData.get('sort_order') ?? 0),
    }

    const parsed = CreateTestReadingSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('test_record_readings')
      .insert({ ...parsed.data, test_record_id: testRecordId, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'create',
      entityType: 'test_record_reading',
      summary: 'Created test reading',
      mutationId,
    })

    revalidatePath('/testing')
    return { success: true }
  })
}

export async function deleteReadingAction(readingId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canDoTestWork(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('test_record_readings')
      .delete()
      .eq('id', readingId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
