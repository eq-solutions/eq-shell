import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { PortalSettingsForm } from './PortalSettingsForm'

/**
 * Portal "Settings" page — currently just notification preferences.
 * Resolves the customer_contacts row matching the auth user's email,
 * reads existing prefs (or app defaults), and renders the form.
 */
export default async function PortalSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/portal/login')

  const { data: customerIdRpc } = await supabase.rpc('get_portal_customer_id')
  const customerId = customerIdRpc as string | null
  if (!customerId) redirect('/portal/login')

  // Find the contact row that owns the prefs.
  const { data: contact } = await supabase
    .from('customer_contacts')
    .select('id')
    .eq('customer_id', customerId)
    .ilike('email', user.email)
    .limit(1)
    .maybeSingle()

  if (!contact) {
    return (
      <Card>
        <div className="text-center py-12">
          <p className="text-sm font-medium text-eq-ink">Contact record missing</p>
          <p className="text-sm text-eq-grey mt-1">
            Your email <strong>{user.email}</strong> isn't on the customer contact list.
            Ask your account manager to add you so notification preferences can be saved.
          </p>
        </div>
      </Card>
    )
  }

  const { data: prefsRow } = await supabase
    .from('customer_notification_preferences')
    .select('receive_monthly_summary, receive_upcoming_visit, receive_critical_defect, receive_variation_approved, receive_report_delivery, monthly_summary_day, consent_given_at')
    .eq('customer_contact_id', contact.id)
    .maybeSingle()

  type PrefsRow = {
    receive_monthly_summary: boolean
    receive_upcoming_visit: boolean
    receive_critical_defect: boolean
    receive_variation_approved: boolean
    receive_report_delivery: boolean
    monthly_summary_day: number
    consent_given_at: string | null
  }
  const initial: PrefsRow = (prefsRow as PrefsRow | null) ?? {
    receive_monthly_summary: true,
    receive_upcoming_visit: true,
    receive_critical_defect: false,
    receive_variation_approved: false,
    receive_report_delivery: true,
    monthly_summary_day: 1,
    consent_given_at: null,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Settings</h1>
        <p className="text-sm text-eq-grey mt-1">
          Signed in as <strong className="text-eq-ink">{user.email}</strong>.
        </p>
      </div>
      <PortalSettingsForm initial={initial} />
    </div>
  )
}
