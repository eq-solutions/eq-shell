'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'

export async function createSiteContactAction(siteId: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const name = (formData.get('name') as string)?.trim()
    if (!name) return { success: false, error: 'Name is required.' }

    const contactRole = (formData.get('role') as string)?.trim() || null
    const email = (formData.get('email') as string)?.trim() || null
    const phone = (formData.get('phone') as string)?.trim() || null
    const isPrimary = formData.get('is_primary') === 'on'

    // If setting as primary, clear existing primary first
    if (isPrimary) {
      await supabase
        .from('site_contacts')
        .update({ is_primary: false })
        .eq('site_id', siteId)
        .eq('is_primary', true)
    }

    const { error } = await supabase
      .from('site_contacts')
      .insert({ site_id: siteId, tenant_id: tenantId, name, role: contactRole, email, phone, is_primary: isPrimary })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'site_contact', summary: `Added contact "${name}" to site` })
    revalidatePath(`/sites/${siteId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateSiteContactAction(contactId: string, siteId: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const name = (formData.get('name') as string)?.trim()
    if (!name) return { success: false, error: 'Name is required.' }

    const contactRole = (formData.get('role') as string)?.trim() || null
    const email = (formData.get('email') as string)?.trim() || null
    const phone = (formData.get('phone') as string)?.trim() || null
    const isPrimary = formData.get('is_primary') === 'on'

    if (isPrimary) {
      await supabase
        .from('site_contacts')
        .update({ is_primary: false })
        .eq('site_id', siteId)
        .eq('is_primary', true)
        .neq('id', contactId)
    }

    const { error } = await supabase
      .from('site_contacts')
      .update({ name, role: contactRole, email, phone, is_primary: isPrimary })
      .eq('id', contactId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'site_contact', entityId: contactId, summary: `Updated contact "${name}"` })
    revalidatePath(`/sites/${siteId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteSiteContactAction(contactId: string, siteId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('site_contacts')
      .delete()
      .eq('id', contactId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'site_contact', entityId: contactId, summary: 'Deleted site contact' })
    revalidatePath(`/sites/${siteId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
