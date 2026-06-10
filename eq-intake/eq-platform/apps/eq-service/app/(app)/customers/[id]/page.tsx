import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils/format'
import { isAdmin as checkIsAdmin, canWrite } from '@/lib/utils/roles'
import type { Customer, CustomerContact, Site, Role } from '@/lib/types'
import { CustomerContacts } from './CustomerContacts'
import { CustomerSitesTable } from './CustomerSitesTable'
import { CustomerDangerZone } from './CustomerDangerZone'
import { CustomerNotificationPrefs, type CustomerContactWithPrefs } from './CustomerNotificationPrefs'

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Get current user role + tenant
  const { data: { user } } = await supabase.auth.getUser()
  let userIsAdmin = false
  let userCanWrite = false
  let tenantId: string | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    const role = (membership?.role as Role) ?? null
    userIsAdmin = checkIsAdmin(role)
    userCanWrite = canWrite(role)
    tenantId = (membership?.tenant_id as string | undefined) ?? null
  }

  // Read tenant.commercial_features_enabled to gate the customer email
  // preferences block.
  let commercialEnabled = false
  if (tenantId) {
    const { data: ts } = await supabase
      .from('tenant_settings')
      .select('commercial_features_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    commercialEnabled = Boolean(
      (ts as { commercial_features_enabled?: boolean } | null)?.commercial_features_enabled,
    )
  }

  // Fetch customer
  const { data: customerRaw } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!customerRaw) {
    return (
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Customers', href: '/customers' }, { label: 'Not Found' }]} />
        <div className="text-center text-eq-grey">
          <p>Customer not found.</p>
        </div>
      </div>
    )
  }

  const customer = customerRaw as Customer

  // Fetch sites first (needed for asset count lookup)
  const [sitesRes, contactsRes] = await Promise.all([
    supabase
      .from('sites')
      .select('*', { count: 'exact' })
      .eq('customer_id', id)
      .eq('is_active', true),
    supabase
      .from('customer_contacts')
      .select('*')
      .eq('customer_id', id)
      .order('is_primary', { ascending: false })
      .order('name'),
  ])

  // Get asset count using the site IDs we already have
  const siteIds = (sitesRes.data ?? []).map((s: { id: string }) => s.id)
  let assetsRes: { count: number | null } = { count: 0 }
  if (siteIds.length > 0) {
    assetsRes = await supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .in('site_id', siteIds)
      .eq('is_active', true)
  }

  const sitesData = (sitesRes.data ?? []) as Site[]
  const sitesCount = sitesRes.count ?? 0
  const assetsCount = assetsRes.count ?? 0
  const contacts = (contactsRes.data ?? []) as CustomerContact[]

  // Resolve customer notification preferences per contact (commercial tier).
  // Single read for all contacts then map locally.
  const contactIds = contacts.map(c => c.id)
  const { data: prefsRows } = contactIds.length > 0
    ? await supabase
        .from('customer_notification_preferences')
        .select('customer_contact_id, receive_monthly_summary, receive_upcoming_visit, receive_critical_defect, receive_variation_approved, receive_report_delivery, monthly_summary_day, consent_given_at')
        .in('customer_contact_id', contactIds)
    : { data: [] }
  type PrefRow = {
    customer_contact_id: string
    receive_monthly_summary: boolean
    receive_upcoming_visit: boolean
    receive_critical_defect: boolean
    receive_variation_approved: boolean
    receive_report_delivery: boolean
    monthly_summary_day: number
    consent_given_at: string | null
  }
  const prefsByContact = new Map<string, PrefRow>()
  for (const r of (prefsRows ?? []) as PrefRow[]) prefsByContact.set(r.customer_contact_id, r)

  const contactsWithPrefs: CustomerContactWithPrefs[] = contacts.map(c => ({
    id: c.id,
    name: c.name,
    email: c.email,
    prefs: prefsByContact.get(c.id) ?? null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Customers', href: '/customers' },
          { label: customer.name },
        ]} />
        <div className="flex items-center gap-4 mt-2">
          {customer.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={customer.logo_url}
              alt={`${customer.name} logo`}
              className="w-14 h-14 rounded-lg object-contain bg-white border border-gray-200 shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-eq-ice flex items-center justify-center text-xl font-bold text-eq-deep shrink-0">
              {customer.name?.charAt(0)?.toUpperCase()}
            </div>
          )}
          <h1 className="text-3xl font-bold text-eq-sky">{customer.name}</h1>
        </div>
      </div>

      {/* Customer Info Header */}
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Code</p>
            <p className="text-sm font-medium text-eq-ink">{customer.code || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Email</p>
            <p className="text-sm font-medium text-eq-ink">{customer.email || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Phone</p>
            <p className="text-sm font-medium text-eq-ink">{customer.phone || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Status</p>
            <div className="mt-1">
              <StatusBadge status={customer.is_active ? 'active' : 'inactive'} />
            </div>
          </div>
        </div>
        {customer.address && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Address</p>
            <p className="text-sm text-eq-ink">
              {customer.address}
            </p>
          </div>
        )}
      </Card>

      {/* Customer Contacts */}
      <CustomerContacts customerId={id} contacts={contacts} isAdmin={userIsAdmin} />

      {/* Customer Email Preferences (commercial tier — Phase C of bridge plan) */}
      <CustomerNotificationPrefs
        customerId={id}
        contacts={contactsWithPrefs}
        commercialEnabled={commercialEnabled}
        canWrite={userCanWrite}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Sites</p>
          <p className="text-3xl font-bold text-eq-ink">{sitesCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Assets</p>
          <p className="text-3xl font-bold text-eq-sky">{assetsCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Created</p>
          <p className="text-sm font-medium text-eq-ink">{formatDate(customer.created_at)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Updated</p>
          <p className="text-sm font-medium text-eq-ink">{formatDate(customer.updated_at)}</p>
        </Card>
      </div>

      {/* Sites Table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-eq-ink">Sites</h2>
          {/* Direct "Add Site" CTA from the customer detail page (UX audit
              PR #149 §A.4 / §2.9 — detail pages were lacking Add-child
              CTAs, forcing the admin to back out to /sites and re-pick the
              customer). Passes ?customer_id=X&new=1 — SiteList reads the
              customer_id (smart-defaults framework, PR D) and the new=1 to
              auto-open the create panel on land. */}
          {userCanWrite && (
            <Link
              href={`/sites?customer_id=${customer.id}&new=1`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-eq-sky rounded hover:bg-eq-deep transition-colors"
            >
              + Add Site
            </Link>
          )}
        </div>
        <CustomerSitesTable sites={sitesData} />
      </div>

      {/* Danger Zone — admin only */}
      {userIsAdmin && (
        <CustomerDangerZone
          customerId={customer.id}
          customerName={customer.name}
          isActive={customer.is_active}
        />
      )}
    </div>
  )
}
