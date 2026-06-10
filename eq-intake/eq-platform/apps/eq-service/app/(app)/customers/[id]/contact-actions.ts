'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'

export async function createCustomerContactAction(customerId: string, formData: FormData) {
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
        .from('customer_contacts')
        .update({ is_primary: false })
        .eq('customer_id', customerId)
        .eq('is_primary', true)
    }

    const { error } = await supabase
      .from('customer_contacts')
      .insert({ customer_id: customerId, tenant_id: tenantId, name, role: contactRole, email, phone, is_primary: isPrimary })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'customer_contact', summary: `Added contact "${name}" to customer` })
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateCustomerContactAction(contactId: string, customerId: string, formData: FormData) {
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
        .from('customer_contacts')
        .update({ is_primary: false })
        .eq('customer_id', customerId)
        .eq('is_primary', true)
        .neq('id', contactId)
    }

    const { error } = await supabase
      .from('customer_contacts')
      .update({ name, role: contactRole, email, phone, is_primary: isPrimary })
      .eq('id', contactId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'customer_contact', entityId: contactId, summary: `Updated contact "${name}"` })
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteCustomerContactAction(contactId: string, customerId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('customer_contacts')
      .delete()
      .eq('id', contactId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'customer_contact', entityId: contactId, summary: 'Deleted customer contact' })
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Upsert customer notification preferences for a contact.
 * Idempotent — creates the row if missing, updates on conflict.
 * Records consent_given_at if any opt-in flag is being set true and the
 * row didn't have a consent timestamp yet.
 */
export async function upsertCustomerNotificationPrefsAction(
  customerId: string,
  contactId: string,
  prefs: {
    receive_monthly_summary: boolean
    receive_upcoming_visit: boolean
    receive_critical_defect: boolean
    receive_variation_approved: boolean
    receive_report_delivery: boolean
    monthly_summary_day?: number
  },
) {
  try {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!isAdmin(role) && role !== 'supervisor') {
      return { success: false, error: 'Admin or supervisor role required.' }
    }

    const day = prefs.monthly_summary_day ?? 1
    if (day < 1 || day > 28) {
      return { success: false, error: 'Monthly summary day must be 1-28.' }
    }

    const anyOptIn =
      prefs.receive_monthly_summary ||
      prefs.receive_upcoming_visit ||
      prefs.receive_critical_defect ||
      prefs.receive_variation_approved ||
      prefs.receive_report_delivery

    // Check existing — preserve consent_given_at if already set.
    const { data: existing } = await supabase
      .from('customer_notification_preferences')
      .select('id, consent_given_at')
      .eq('customer_contact_id', contactId)
      .maybeSingle()

    const consentSet = anyOptIn && !existing?.consent_given_at
      ? { consent_given_at: new Date().toISOString(), consent_given_by_user_id: user.id }
      : {}

    const { error } = await supabase
      .from('customer_notification_preferences')
      .upsert({
        tenant_id: tenantId,
        customer_contact_id: contactId,
        receive_monthly_summary: prefs.receive_monthly_summary,
        receive_upcoming_visit: prefs.receive_upcoming_visit,
        receive_critical_defect: prefs.receive_critical_defect,
        receive_variation_approved: prefs.receive_variation_approved,
        receive_report_delivery: prefs.receive_report_delivery,
        monthly_summary_day: day,
        ...consentSet,
      }, { onConflict: 'customer_contact_id' })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'customer_notification_preferences',
      entityId: contactId,
      summary: 'Updated customer notification prefs',
      metadata: { ...prefs, monthly_summary_day: day },
    })
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
