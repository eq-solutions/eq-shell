'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { CreateInstrumentSchema, UpdateInstrumentSchema } from '@/lib/validations/instrument'

export async function createInstrumentAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      instrument_type: formData.get('instrument_type'),
      make: formData.get('make') || null,
      model: formData.get('model') || null,
      serial_number: formData.get('serial_number') || null,
      asset_tag: formData.get('asset_tag') || null,
      calibration_date: formData.get('calibration_date') || null,
      calibration_due: formData.get('calibration_due') || null,
      calibration_cert: formData.get('calibration_cert') || null,
      status: formData.get('status') || 'Active',
      assigned_to: formData.get('assigned_to') || null,
      notes: formData.get('notes') || null,
    }

    const parsed = CreateInstrumentSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('instruments')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'instrument', summary: `Created instrument "${parsed.data.name}"` })
    revalidatePath('/instruments')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateInstrumentAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      instrument_type: formData.get('instrument_type'),
      make: formData.get('make') || null,
      model: formData.get('model') || null,
      serial_number: formData.get('serial_number') || null,
      asset_tag: formData.get('asset_tag') || null,
      calibration_date: formData.get('calibration_date') || null,
      calibration_due: formData.get('calibration_due') || null,
      calibration_cert: formData.get('calibration_cert') || null,
      status: formData.get('status') || 'Active',
      assigned_to: formData.get('assigned_to') || null,
      notes: formData.get('notes') || null,
    }

    const parsed = UpdateInstrumentSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('instruments')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'instrument', entityId: id, summary: 'Updated instrument' })
    revalidatePath('/instruments')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function importInstrumentsAction(
  instruments: {
    name: string
    instrument_type: string
    make: string | null
    model: string | null
    serial_number: string | null
    asset_tag: string | null
    calibration_date: string | null
    calibration_due: string | null
    calibration_cert: string | null
    status: string | null
    notes: string | null
  }[]
) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }

    if (instruments.length === 0) return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] as string[] }
    if (instruments.length > 500) return { success: false, error: 'Maximum 500 rows per import.', imported: 0, rowErrors: [] as string[] }

    const validStatuses = ['Active', 'Out for Cal', 'Retired', 'Lost']
    const rowErrors: string[] = []
    const validRows: typeof instruments = []

    for (let i = 0; i < instruments.length; i++) {
      const row = instruments[i]
      if (!row.name?.trim()) { rowErrors.push(`Row ${i + 1}: Name is required.`); continue }
      if (!row.instrument_type?.trim()) { rowErrors.push(`Row ${i + 1}: Instrument type is required.`); continue }
      if (row.status && !validStatuses.includes(row.status)) {
        rowErrors.push(`Row ${i + 1}: Invalid status "${row.status}". Must be one of: ${validStatuses.join(', ')}`)
        continue
      }
      validRows.push(row)
    }

    if (validRows.length === 0) {
      return { success: false, error: 'No valid rows after validation.', imported: 0, rowErrors }
    }

    const insertRows = validRows.map((r) => ({
      ...r,
      tenant_id: tenantId,
      status: r.status || 'Active',
    }))
    const { error } = await supabase.from('instruments').insert(insertRows)

    if (error) return { success: false, error: error.message, imported: 0, rowErrors }

    await logAuditEvent({ action: 'create', entityType: 'instrument', summary: `Imported ${validRows.length} instruments from CSV` })
    revalidatePath('/instruments')
    return { success: true, imported: validRows.length, rowErrors }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
  }
}

export async function toggleInstrumentActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    const { error } = await supabase
      .from('instruments')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'instrument', entityId: id, summary: isActive ? 'Reactivated instrument' : 'Deactivated instrument' })
    revalidatePath('/instruments')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
