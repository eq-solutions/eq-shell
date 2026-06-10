'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Self-serve customer notification preferences from the portal.
 *
 * The logged-in portal user (auth.users row, magic-link session) maps
 * to one or more customer_contacts rows by email. We resolve the contact
 * via get_portal_customer_id (returns the customer) + match by email,
 * then upsert the customer_notification_preferences row for that contact.
 *
 * Records consent_given_at + consent_given_by_user_id (the customer
 * themselves) the first time any opt-in flag is set true. Provides a
 * compliance trail equivalent to the admin-side flow.
 */
export async function updatePortalNotificationPrefsAction(prefs: {
  receive_monthly_summary: boolean
  receive_upcoming_visit: boolean
  receive_critical_defect: boolean
  receive_variation_approved: boolean
  receive_report_delivery: boolean
  monthly_summary_day?: number
}) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return { success: false as const, error: 'Not signed in.' }

    // Resolve the contact row for this email + this customer. If the
    // customer has multiple contacts with the same email (rare but
    // possible), we update all of them — keeps prefs consistent.
    const [{ data: customerIdRpc }, { data: tenantIdRpc }] = await Promise.all([
      supabase.rpc('get_portal_customer_id'),
      supabase.rpc('get_portal_tenant_id'),
    ])
    const customerId = customerIdRpc as string | null
    const tenantId = tenantIdRpc as string | null
    if (!customerId || !tenantId) {
      return { success: false as const, error: 'No customer record linked to your account.' }
    }

    const { data: contacts } = await supabase
      .from('customer_contacts')
      .select('id')
      .eq('customer_id', customerId)
      .ilike('email', user.email)
    const contactList = ((contacts ?? []) as Array<{ id: string }>)
    if (contactList.length === 0) {
      return { success: false as const, error: 'No contact record matched your email.' }
    }

    const day = prefs.monthly_summary_day ?? 1
    if (day < 1 || day > 28) return { success: false as const, error: 'Monthly summary day must be 1-28.' }

    const anyOptIn =
      prefs.receive_monthly_summary ||
      prefs.receive_upcoming_visit ||
      prefs.receive_critical_defect ||
      prefs.receive_variation_approved ||
      prefs.receive_report_delivery

    for (const c of contactList) {
      const { data: existing } = await supabase
        .from('customer_notification_preferences')
        .select('id, consent_given_at')
        .eq('customer_contact_id', c.id)
        .maybeSingle()
      const consentSet = anyOptIn && !existing?.consent_given_at
        ? { consent_given_at: new Date().toISOString(), consent_given_by_user_id: user.id }
        : {}

      const { error } = await supabase
        .from('customer_notification_preferences')
        .upsert({
          tenant_id: tenantId,
          customer_contact_id: c.id,
          receive_monthly_summary: prefs.receive_monthly_summary,
          receive_upcoming_visit: prefs.receive_upcoming_visit,
          receive_critical_defect: prefs.receive_critical_defect,
          receive_variation_approved: prefs.receive_variation_approved,
          receive_report_delivery: prefs.receive_report_delivery,
          monthly_summary_day: day,
          ...consentSet,
        }, { onConflict: 'customer_contact_id' })
      if (error) return { success: false as const, error: error.message }
    }

    revalidatePath('/portal/settings')
    return { success: true as const, contactsUpdated: contactList.length }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}
