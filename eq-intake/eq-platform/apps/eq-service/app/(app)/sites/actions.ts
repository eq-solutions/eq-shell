'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'
import { CreateSiteSchema, UpdateSiteSchema } from '@/lib/validations/site'
import { zodToErrorMap } from '@/lib/utils/zodErrors'

export async function createSiteAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      code: formData.get('code') || null,
      customer_id: formData.get('customer_id') || null,
      address: formData.get('address') || null,
      city: formData.get('city') || null,
      state: formData.get('state') || null,
      postcode: formData.get('postcode') || null,
      country: formData.get('country') || 'Australia',
      latitude: formData.get('latitude') ? Number(formData.get('latitude')) : null,
      longitude: formData.get('longitude') ? Number(formData.get('longitude')) : null,
    }

    const parsed = CreateSiteSchema.safeParse(raw)
    if (!parsed.success) {
      // PR H: surface per-field errors alongside the legacy summary so
      // SiteForm can render the message next to the offending input
      // instead of a single red line at the bottom of the panel.
      return {
        success: false,
        error: parsed.error.issues[0].message,
        errors: zodToErrorMap(parsed.error.issues),
      }
    }

    const photoUrl = (formData.get('photo_url') as string)?.trim() || null
    const logoUrl = (formData.get('logo_url') as string)?.trim() || null
    const logoUrlOnDark = (formData.get('logo_url_on_dark') as string)?.trim() || null

    const { error } = await supabase
      .from('sites')
      .insert({ ...parsed.data, photo_url: photoUrl, logo_url: logoUrl, logo_url_on_dark: logoUrlOnDark, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'site', summary: `Created site "${parsed.data.name}"` })
    revalidatePath('/sites')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateSiteAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      code: formData.get('code') || null,
      customer_id: formData.get('customer_id') || null,
      address: formData.get('address') || null,
      city: formData.get('city') || null,
      state: formData.get('state') || null,
      postcode: formData.get('postcode') || null,
      country: formData.get('country') || 'Australia',
      latitude: formData.get('latitude') ? Number(formData.get('latitude')) : null,
      longitude: formData.get('longitude') ? Number(formData.get('longitude')) : null,
    }

    const parsed = UpdateSiteSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0].message,
        errors: zodToErrorMap(parsed.error.issues),
      }
    }

    const photoUrl = (formData.get('photo_url') as string)?.trim() || null
    const logoUrl = (formData.get('logo_url') as string)?.trim() || null
    const logoUrlOnDark = (formData.get('logo_url_on_dark') as string)?.trim() || null

    const { error } = await supabase
      .from('sites')
      .update({ ...parsed.data, photo_url: photoUrl, logo_url: logoUrl, logo_url_on_dark: logoUrlOnDark })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'site', entityId: id, summary: 'Updated site' })
    revalidatePath('/sites')
    revalidatePath(`/sites/${id}`)
    revalidatePath('/customers')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function importSitesAction(
  sites: {
    name: string
    code: string | null
    customer_name: string | null
    address: string | null
    city: string | null
    state: string | null
    postcode: string | null
    country: string | null
  }[]
) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }

    if (sites.length === 0) return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] as string[] }
    if (sites.length > 500) return { success: false, error: 'Maximum 500 rows per import.', imported: 0, rowErrors: [] as string[] }

    const rowErrors: string[] = []
    const validRows: typeof sites = []

    for (let i = 0; i < sites.length; i++) {
      const row = sites[i]
      if (!row.name?.trim()) { rowErrors.push(`Row ${i + 1}: Name is required.`); continue }
      validRows.push(row)
    }

    if (validRows.length === 0) {
      return { success: false, error: 'No valid rows after validation.', imported: 0, rowErrors }
    }

    // --- Auto-create missing customers ---
    // Collect unique customer names from import data
    const uniqueCustomerNames = [...new Set(
      validRows
        .map((r) => r.customer_name?.trim())
        .filter((n): n is string => !!n)
    )]

    // Build customer name → id map from existing records
    const customerMap: Record<string, string> = {}
    if (uniqueCustomerNames.length > 0) {
      const { data: existingCustomers } = await supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)

      for (const c of existingCustomers ?? []) {
        customerMap[c.name.toLowerCase()] = c.id
      }

      // Find names that don't exist yet
      const missingNames = uniqueCustomerNames.filter(
        (n) => !customerMap[n.toLowerCase()]
      )

      // Auto-create missing customers
      if (missingNames.length > 0) {
        const newCustomers = missingNames.map((name) => ({
          name,
          tenant_id: tenantId,
        }))
        const { data: created, error: createErr } = await supabase
          .from('customers')
          .insert(newCustomers)
          .select('id, name')

        if (createErr) {
          rowErrors.push(`Failed to create customers: ${createErr.message}`)
        } else {
          for (const c of created ?? []) {
            customerMap[c.name.toLowerCase()] = c.id
          }
          rowErrors.push(`Auto-created ${created?.length ?? 0} new customers: ${missingNames.join(', ')}`)
        }
      }
    }

    const insertRows = validRows.map((r) => ({
      name: r.name,
      code: r.code,
      customer_id: r.customer_name ? (customerMap[r.customer_name.trim().toLowerCase()] ?? null) : null,
      address: r.address,
      city: r.city,
      state: r.state,
      postcode: r.postcode,
      country: r.country || 'Australia',
      tenant_id: tenantId,
    }))
    const { error } = await supabase.from('sites').insert(insertRows)

    if (error) return { success: false, error: error.message, imported: 0, rowErrors }

    await logAuditEvent({ action: 'create', entityType: 'site', summary: `Imported ${validRows.length} sites from CSV` })
    revalidatePath('/sites')
    revalidatePath('/customers')
    return { success: true, imported: validRows.length, rowErrors }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
  }
}

export async function toggleSiteActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('sites')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'site', entityId: id, summary: isActive ? 'Reactivated site' : 'Deactivated site' })
    revalidatePath('/sites')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
