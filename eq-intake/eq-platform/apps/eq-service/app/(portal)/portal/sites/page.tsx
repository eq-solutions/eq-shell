import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Building2, Package, AlertTriangle, CheckCircle2, Calendar } from 'lucide-react'
import { formatDate } from '@/lib/utils/format'

/**
 * Portal "Overview" / "Your Sites" page.
 *
 * Shows each site the customer owns with its asset count, last completed
 * visit, next scheduled visit, and open-defect count. Acts as the portal
 * landing page after login — wide visual signal of "we're across your
 * sites" without overwhelming the customer with detail.
 *
 * Auth: portal magic-link session. Resolves customer_id via the
 * get_portal_customer_id() helper (migration 0090). If no match, sends
 * the user back to login.
 */
export default async function PortalSitesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/portal/login')

  const { data: customerIdRpc } = await supabase.rpc('get_portal_customer_id')
  const customerId = customerIdRpc as string | null
  if (!customerId) {
    return (
      <Card>
        <div className="text-center py-12">
          <Building2 className="w-10 h-10 text-eq-grey mx-auto mb-2" />
          <p className="text-sm font-medium text-eq-ink">No customer record found</p>
          <p className="text-sm text-eq-grey mt-1">
            Your email <strong>{user.email}</strong> isn't linked to a customer account yet.
            Contact your account manager to be added.
          </p>
        </div>
      </Card>
    )
  }

  // Fetch the site list, then per-site KPIs in parallel.
  const { data: sitesRaw } = await supabase
    .from('sites')
    .select('id, name, code, city, state, address')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .order('name')

  type Site = { id: string; name: string; code: string | null; city: string | null; state: string | null; address: string | null }
  const sites = (sitesRaw ?? []) as Site[]

  if (sites.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <Building2 className="w-10 h-10 text-eq-grey mx-auto mb-2" />
          <p className="text-sm font-medium text-eq-ink">No sites yet</p>
          <p className="text-sm text-eq-grey mt-1">When sites are added to your account they'll appear here.</p>
        </div>
      </Card>
    )
  }

  const stats = await Promise.all(
    sites.map(async (s) => {
      const [assetsRes, lastVisitRes, nextVisitRes, openDefectsRes] = await Promise.all([
        supabase.from('assets').select('id', { count: 'exact', head: true })
          .eq('site_id', s.id).eq('is_active', true),
        supabase.from('maintenance_checks').select('id, completed_at, custom_name')
          .eq('site_id', s.id).eq('status', 'complete')
          .eq('is_active', true)
          .order('completed_at', { ascending: false })
          .limit(1).maybeSingle(),
        supabase.from('maintenance_checks').select('id, due_date, custom_name')
          .eq('site_id', s.id).in('status', ['scheduled', 'in_progress'])
          .eq('is_active', true)
          .order('due_date', { ascending: true })
          .limit(1).maybeSingle(),
        supabase.from('defects').select('id', { count: 'exact', head: true })
          .eq('site_id', s.id).in('status', ['open', 'in_progress']),
      ])
      return {
        site: s,
        assetCount: assetsRes.count ?? 0,
        lastVisit: lastVisitRes.data as { completed_at: string; custom_name: string | null } | null,
        nextVisit: nextVisitRes.data as { due_date: string; custom_name: string | null } | null,
        openDefects: openDefectsRes.count ?? 0,
      }
    }),
  )

  const totalAssets = stats.reduce((s, x) => s + x.assetCount, 0)
  const totalDefects = stats.reduce((s, x) => s + x.openDefects, 0)
  const upcomingCount = stats.filter(x => x.nextVisit).length

  return (
    <div className="space-y-6">
      {/* Headline strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Sites" value={sites.length} icon={<Building2 className="w-4 h-4" />} tone="ink" />
        <KpiTile label="Assets" value={totalAssets} icon={<Package className="w-4 h-4" />} tone="ink" />
        <KpiTile label="Upcoming visits" value={upcomingCount} icon={<Calendar className="w-4 h-4" />} tone="sky" />
        <KpiTile label="Open defects" value={totalDefects} icon={<AlertTriangle className="w-4 h-4" />} tone={totalDefects > 0 ? 'amber' : 'ink'} />
      </div>

      <div>
        <h1 className="text-xl font-bold text-eq-ink mb-3">Your sites</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.map(({ site, assetCount, lastVisit, nextVisit, openDefects }) => (
            <Card key={site.id}>
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-eq-ink truncate">{site.name}</p>
                    <p className="text-xs text-eq-grey">
                      {site.code ? `${site.code} · ` : ''}{[site.city, site.state].filter(Boolean).join(', ') || '—'}
                    </p>
                  </div>
                  {openDefects > 0 ? (
                    <StatusBadge status="overdue" label={`${openDefects} defect${openDefects === 1 ? '' : 's'}`} />
                  ) : (
                    <StatusBadge status="active" label="Healthy" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md bg-eq-ice/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">Assets</p>
                    <p className="text-base font-semibold text-eq-deep">{assetCount}</p>
                  </div>
                  <div className="rounded-md bg-gray-50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">Last visit</p>
                    <p className="text-xs text-eq-ink mt-0.5">
                      {lastVisit?.completed_at ? formatDate(lastVisit.completed_at) : '—'}
                    </p>
                  </div>
                </div>
                <div className="rounded-md border border-gray-100 px-3 py-2 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-eq-grey shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">Next visit</p>
                    {nextVisit ? (
                      <p className="text-xs text-eq-ink truncate">
                        {formatDate(nextVisit.due_date)} — {nextVisit.custom_name ?? 'Maintenance check'}
                      </p>
                    ) : (
                      <p className="text-xs text-eq-grey">No visits scheduled</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-3 p-1">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-eq-ink">Need to dig deeper?</p>
            <p className="text-xs text-eq-grey">
              Use the tabs above to see your contracted scope, upcoming visits, defects on your assets, and downloadable reports.
            </p>
          </div>
          <Link href="/portal" className="text-xs font-semibold text-eq-sky hover:text-eq-deep whitespace-nowrap">
            View reports →
          </Link>
        </div>
      </Card>
    </div>
  )
}

function KpiTile({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'ink' | 'sky' | 'amber' }) {
  const palette = tone === 'amber'
    ? 'bg-amber-50 text-amber-800'
    : tone === 'sky'
      ? 'bg-eq-ice text-eq-deep'
      : 'bg-white text-eq-ink'
  return (
    <div className={`rounded-lg border border-gray-200 px-3 py-3 ${palette}`}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[10px] uppercase tracking-wide font-bold opacity-80">{label}</p>
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}
