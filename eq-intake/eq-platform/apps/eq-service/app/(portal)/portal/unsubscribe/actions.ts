'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnsubscribeToken, type UnsubscribeScope } from '@/lib/email/unsubscribe-token'

/**
 * Process an unsubscribe action.
 *
 * Token-only auth — no Supabase session required. The signed token IS
 * the auth credential; verifying it proves the request came from a
 * link we minted, scoped to a specific customer_contact_id.
 *
 * Returns the resulting state so the page can show a confirmation +
 * what was changed. Idempotent: re-applying an unsubscribe is a no-op.
 *
 * Scope semantics:
 *   - 'all'       → receive_monthly_summary = false AND receive_upcoming_visit = false
 *   - 'monthly'   → receive_monthly_summary = false (upcoming untouched)
 *   - 'upcoming'  → receive_upcoming_visit  = false (monthly untouched)
 *
 * AU Spam Act 2003 s18: "no fee, no functional barrier, processed at
 * request time." We update the prefs row synchronously here.
 */
export async function processUnsubscribeAction(token: string): Promise<
  | { success: true; contactName: string | null; customerName: string | null; scope: UnsubscribeScope; appliedMonthly: boolean; appliedUpcoming: boolean }
  | { success: false; error: string }
> {
  try {
    const payload = verifyUnsubscribeToken(token)
    if (!payload) {
      return { success: false, error: 'This unsubscribe link is invalid or expired. Reply to the email if you need help.' }
    }

    const supabase = createAdminClient()

    // Build the patch based on scope.
    const patch: { receive_monthly_summary?: boolean; receive_upcoming_visit?: boolean } = {}
    const appliedMonthly = payload.s === 'all' || payload.s === 'monthly'
    const appliedUpcoming = payload.s === 'all' || payload.s === 'upcoming'
    if (appliedMonthly) patch.receive_monthly_summary = false
    if (appliedUpcoming) patch.receive_upcoming_visit = false

    // The prefs row may not exist yet (a contact who's never had prefs
    // toggled). Upsert with customer_contact_id as the conflict target.
    // tenant_id is required by the table; derive it via the contact.
    const { data: contactRow } = await supabase
      .from('customer_contacts')
      .select('id, name, tenant_id, customers(name)')
      .eq('id', payload.cid)
      .maybeSingle()
    if (!contactRow) {
      return { success: false, error: 'This unsubscribe link is invalid. Reply to the email if you need help.' }
    }

    type ContactJoin = {
      id: string
      name: string | null
      tenant_id: string
      customers: { name?: string } | { name?: string }[] | null
    }
    const c = contactRow as ContactJoin
    const customers = Array.isArray(c.customers) ? c.customers[0] : c.customers

    await supabase
      .from('customer_notification_preferences')
      .upsert(
        {
          customer_contact_id: payload.cid,
          tenant_id: c.tenant_id,
          ...patch,
        },
        { onConflict: 'customer_contact_id' },
      )

    return {
      success: true,
      contactName: c.name,
      customerName: customers?.name ?? null,
      scope: payload.s,
      appliedMonthly,
      appliedUpcoming,
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unsubscribe failed.' }
  }
}

/**
 * Re-subscribe — counterpart action so the confirmation page can offer
 * an "I changed my mind" button. Same auth: signed token.
 */
export async function resubscribeAction(token: string): Promise<
  | { success: true; scope: UnsubscribeScope }
  | { success: false; error: string }
> {
  try {
    const payload = verifyUnsubscribeToken(token)
    if (!payload) return { success: false, error: 'Invalid link.' }

    const supabase = createAdminClient()
    const patch: { receive_monthly_summary?: boolean; receive_upcoming_visit?: boolean } = {}
    if (payload.s === 'all' || payload.s === 'monthly') patch.receive_monthly_summary = true
    if (payload.s === 'all' || payload.s === 'upcoming') patch.receive_upcoming_visit = true

    const { data: contactRow } = await supabase
      .from('customer_contacts')
      .select('tenant_id')
      .eq('id', payload.cid)
      .maybeSingle()
    if (!contactRow) return { success: false, error: 'Invalid link.' }

    await supabase
      .from('customer_notification_preferences')
      .upsert(
        {
          customer_contact_id: payload.cid,
          tenant_id: (contactRow as { tenant_id: string }).tenant_id,
          ...patch,
        },
        { onConflict: 'customer_contact_id' },
      )

    return { success: true, scope: payload.s }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Re-subscribe failed.' }
  }
}
