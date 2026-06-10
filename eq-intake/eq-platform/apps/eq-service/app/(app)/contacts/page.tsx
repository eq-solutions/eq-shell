/**
 * /contacts — master contacts list
 *
 * Reads from the two existing contact tables (customer_contacts, site_contacts)
 * and unions them into a single list. No new table — the authoritative storage
 * stays where it is, this page is just the aggregate view.
 *
 * Filters by:
 *   - kind: 'all' | 'customer' | 'site'
 *   - search: name / role / email / phone
 *   - primary_only: toggle to show only is_primary rows
 *
 * Editing still happens in the customer/site detail pages — this page links
 * out to those via the parent column.
 */

import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ContactList } from './ContactList'
import type { MasterContact } from './ContactList'
import { isAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; kind?: string; primary_only?: string }>
}) {
  const params = await searchParams
  const search = (params.search ?? '').trim().toLowerCase()
  const kind = (params.kind === 'customer' || params.kind === 'site') ? params.kind : 'all'
  const primaryOnly = params.primary_only === '1'

  const supabase = await createClient()

  // Role
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Parallel fetch — customer_contacts + site_contacts (RLS filters tenant)
  const [customerContactsRes, siteContactsRes] = await Promise.all([
    kind === 'site'
      ? Promise.resolve({ data: [] })
      : supabase
          .from('customer_contacts')
          .select('id, name, role, email, phone, is_primary, customer_id, created_at, customers(name)')
          .order('name'),
    kind === 'customer'
      ? Promise.resolve({ data: [] })
      : supabase
          .from('site_contacts')
          .select('id, name, role, email, phone, is_primary, site_id, created_at, sites(name, customer_id, customers(name))')
          .order('name'),
  ])

  const contacts: MasterContact[] = []

  // Supabase's FK-expansion shape varies: PostgREST returns the related row as
  // an object for many-to-one joins, but the generated TS helpers type it as
  // an array. Coalesce both shapes with a small helper.
  const firstOrSelf = <T,>(v: T | T[] | null | undefined): T | null => {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }

  type RawCustomerContact = {
    id: string; name: string; role: string | null; email: string | null;
    phone: string | null; is_primary: boolean; customer_id: string; created_at: string;
    customers: { name: string } | { name: string }[] | null
  }
  for (const c of ((customerContactsRes.data ?? []) as unknown as RawCustomerContact[])) {
    const customer = firstOrSelf(c.customers)
    contacts.push({
      id: c.id,
      kind: 'customer',
      name: c.name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      isPrimary: c.is_primary,
      parentName: customer?.name ?? '—',
      parentHref: `/customers/${c.customer_id}`,
      createdAt: c.created_at,
    })
  }

  type RawSiteContact = {
    id: string; name: string; role: string | null; email: string | null;
    phone: string | null; is_primary: boolean; site_id: string; created_at: string;
    sites:
      | { name: string; customer_id: string | null; customers: { name: string } | { name: string }[] | null }
      | { name: string; customer_id: string | null; customers: { name: string } | { name: string }[] | null }[]
      | null
  }
  for (const c of ((siteContactsRes.data ?? []) as unknown as RawSiteContact[])) {
    const site = firstOrSelf(c.sites)
    const siteCustomer = firstOrSelf(site?.customers ?? null)
    const siteLabel = siteCustomer?.name
      ? `${siteCustomer.name} — ${site?.name ?? '—'}`
      : (site?.name ?? '—')
    contacts.push({
      id: c.id,
      kind: 'site',
      name: c.name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      isPrimary: c.is_primary,
      parentName: siteLabel,
      parentHref: `/sites/${c.site_id}`,
      createdAt: c.created_at,
    })
  }

  // In-memory filters (dataset is small — contacts per tenant is typically <1k)
  let filtered = contacts
  if (primaryOnly) filtered = filtered.filter(c => c.isPrimary)
  if (search) {
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(search) ||
      (c.role ?? '').toLowerCase().includes(search) ||
      (c.email ?? '').toLowerCase().includes(search) ||
      (c.phone ?? '').toLowerCase().includes(search) ||
      c.parentName.toLowerCase().includes(search)
    )
  }
  // Sort: primary-first, then name
  filtered.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Contacts' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Contacts</h1>
        <p className="text-sm text-eq-grey mt-1">
          Master list of customer and site contacts across the tenant. Edit contacts on each customer or site page.
        </p>
      </div>
      <ContactList
        contacts={filtered}
        kind={kind}
        primaryOnly={primaryOnly}
        isAdmin={isAdmin(userRole)}
      />
    </div>
  )
}
