import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils/format'
import { isAdmin as checkIsAdmin, canWrite } from '@/lib/utils/roles'
import type { Site, Asset, MaintenanceCheck, TestRecord, SiteContact, Role } from '@/lib/types'
import { SiteContacts } from './SiteContacts'
import { SiteAssetsTable, SiteMaintenanceChecksTable, SiteTestRecordsTable } from './SiteDetailTables'

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Get current user role
  const { data: { user } } = await supabase.auth.getUser()
  let userIsAdmin = false
  let userCanWrite = false
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    const role = (membership?.role as Role) ?? null
    userIsAdmin = checkIsAdmin(role)
    userCanWrite = canWrite(role)
  }

  // Fetch site with customer info
  const { data: siteRaw } = await supabase
    .from('sites')
    .select('*, customers(name, logo_url)')
    .eq('id', id)
    .maybeSingle()

  if (!siteRaw) {
    return (
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Sites', href: '/sites' }, { label: 'Not Found' }]} />
        <div className="text-center text-eq-grey">
          <p>Site not found.</p>
        </div>
      </div>
    )
  }

  const site = siteRaw as Site & { customers: { name: string; logo_url: string | null } | null }

  // Fetch counts and data in parallel
  const [
    assetsRes,
    activeChecksRes,
    completedChecksRes,
    testRecordsRes,
    recentAssetsRes,
    recentChecksRes,
    recentTestsRes,
    contactsRes,
  ] = await Promise.all([
    // Asset count
    supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('is_active', true),
    // Active maintenance checks count
    supabase
      .from('maintenance_checks')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('is_active', true)
      .neq('status', 'complete'),
    // Completed maintenance checks count
    supabase
      .from('maintenance_checks')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('is_active', true)
      .eq('status', 'complete'),
    // Test records count
    supabase
      .from('test_records')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('is_active', true),
    // Recent assets (top 10)
    supabase
      .from('assets')
      .select('*')
      .eq('site_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(10),
    // Recent maintenance checks (top 5)
    supabase
      .from('maintenance_checks')
      .select('*, job_plans(name)')
      .eq('site_id', id)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(5),
    // Recent test records (top 5)
    supabase
      .from('test_records')
      .select('*')
      .eq('site_id', id)
      .eq('is_active', true)
      .order('test_date', { ascending: false })
      .limit(5),
    // Site contacts
    supabase
      .from('site_contacts')
      .select('*')
      .eq('site_id', id)
      .order('is_primary', { ascending: false })
      .order('name'),
  ])

  const assetCount = assetsRes.count ?? 0
  const activeChecksCount = activeChecksRes.count ?? 0
  const completedChecksCount = completedChecksRes.count ?? 0
  const testRecordsCount = testRecordsRes.count ?? 0

  const recentAssets = (recentAssetsRes.data ?? []) as Asset[]
  const recentChecks = (recentChecksRes.data ?? []) as (MaintenanceCheck & { job_plans: { name: string } | null })[]
  const recentTests = (recentTestsRes.data ?? []) as TestRecord[]
  const contacts = (contactsRes.data ?? []) as SiteContact[]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Sites', href: '/sites' },
          { label: site.name },
        ]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">{site.name}</h1>
      </div>

      {/* Site Info Header */}
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Code</p>
            <p className="text-sm font-medium text-eq-ink">{site.code || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Customer</p>
            <div className="flex items-center gap-2 mt-0.5">
              {site.customers?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={site.customers.logo_url}
                  alt=""
                  className="w-7 h-7 rounded object-contain bg-gray-50 border border-gray-100 shrink-0"
                />
              ) : site.customers?.name ? (
                <div className="w-7 h-7 rounded bg-eq-ice flex items-center justify-center text-[11px] font-bold text-eq-deep shrink-0">
                  {site.customers.name.charAt(0).toUpperCase()}
                </div>
              ) : null}
              <p className="text-sm font-medium text-eq-ink">{site.customers?.name || '-'}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Status</p>
            <div className="mt-1">
              <StatusBadge status={site.is_active ? 'active' : 'inactive'} />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Created</p>
            <p className="text-sm font-medium text-eq-ink">{formatDate(site.created_at)}</p>
          </div>
        </div>
        {site.address && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Address</p>
            <p className="text-sm text-eq-ink">
              {site.address}
              {site.city && `, ${site.city}`}
              {site.state && `, ${site.state}`}
              {site.postcode && ` ${site.postcode}`}
              {site.country && `, ${site.country}`}
            </p>
          </div>
        )}
      </Card>

      {/* Site Contacts */}
      <SiteContacts siteId={id} contacts={contacts} isAdmin={userIsAdmin} />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Assets</p>
          <p className="text-3xl font-bold text-eq-ink">{assetCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Active Checks</p>
          <p className="text-3xl font-bold text-eq-sky">{activeChecksCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Completed Checks</p>
          <p className="text-3xl font-bold text-green-600">{completedChecksCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Test Records</p>
          <p className="text-3xl font-bold text-eq-deep">{testRecordsCount}</p>
        </Card>
      </div>

      {/* Recent Assets Table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-eq-ink">Recent Assets</h2>
          {/* Direct "Add Asset" CTA from the site detail page (UX audit
              PR #149 §A.4 / §2.9). Passes ?site_id=X&new=1 — AssetList
              reads site_id (smart-defaults framework, PR D) and new=1
              auto-opens the create panel on land. */}
          {userCanWrite && (
            <Link
              href={`/assets?site_id=${site.id}&new=1`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-eq-sky rounded hover:bg-eq-deep transition-colors"
            >
              + Add Asset
            </Link>
          )}
        </div>
        <SiteAssetsTable assets={recentAssets} />
      </div>

      {/* Recent Maintenance Checks Table */}
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Recent Maintenance Checks</h2>
        <SiteMaintenanceChecksTable checks={recentChecks} />
      </div>

      {/* Recent Test Records Table */}
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Recent Test Records</h2>
        <SiteTestRecordsTable tests={recentTests} />
      </div>
    </div>
  )
}
