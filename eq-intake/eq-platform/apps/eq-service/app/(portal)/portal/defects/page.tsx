import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { AlertTriangle, MapPin, ShieldCheck } from 'lucide-react'
import { formatDate } from '@/lib/utils/format'

/**
 * Portal "Defects" page — open + recently-resolved defects on the
 * customer's assets. Severity-coded for quick triage.
 */
const severityColour: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-amber-100 text-amber-800 border-amber-200',
  low:      'bg-sky-100 text-sky-700 border-sky-200',
}

export default async function PortalDefectsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/portal/login')

  const { data: customerIdRpc } = await supabase.rpc('get_portal_customer_id')
  const customerId = customerIdRpc as string | null
  if (!customerId) redirect('/portal/login')

  const { data: sitesRows } = await supabase
    .from('sites')
    .select('id')
    .eq('customer_id', customerId)
    .eq('is_active', true)
  const siteIds = ((sitesRows ?? []) as Array<{ id: string }>).map(s => s.id)
  if (siteIds.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <ShieldCheck className="w-10 h-10 text-green-600 mx-auto mb-2" />
          <p className="text-sm font-medium text-eq-ink">All clear</p>
          <p className="text-sm text-eq-grey mt-1">No sites yet, so nothing to report.</p>
        </div>
      </Card>
    )
  }

  const [openRes, recentResolvedRes] = await Promise.all([
    supabase
      .from('defects')
      .select('id, title, description, severity, status, created_at, work_order_number, sites(name), assets(name)')
      .in('site_id', siteIds)
      .in('status', ['open', 'in_progress'])
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('defects')
      .select('id, title, severity, resolved_at, sites(name)')
      .in('site_id', siteIds)
      .eq('status', 'resolved')
      .not('resolved_at', 'is', null)
      .order('resolved_at', { ascending: false })
      .limit(15),
  ])

  type DefectRow = {
    id: string; title: string; description: string | null
    severity: string; status: string
    created_at: string
    work_order_number: string | null
    sites: { name: string } | { name: string }[] | null
    assets: { name: string } | { name: string }[] | null
  }
  type ResolvedRow = {
    id: string; title: string; severity: string
    resolved_at: string
    sites: { name: string } | { name: string }[] | null
  }
  const open = (openRes.data ?? []) as DefectRow[]
  const recent = (recentResolvedRes.data ?? []) as ResolvedRow[]

  const severityCounts = open.reduce((acc, d) => {
    acc[d.severity] = (acc[d.severity] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-eq-ink">Open defects</h1>
          <p className="text-xs text-eq-grey">{open.length} total</p>
        </div>
        {open.length === 0 ? (
          <Card>
            <div className="text-center py-10">
              <ShieldCheck className="w-10 h-10 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-eq-ink">All clear</p>
              <p className="text-sm text-eq-grey mt-1">No open defects on your assets.</p>
            </div>
          </Card>
        ) : (
          <>
            {/* Severity strip */}
            <div className="flex flex-wrap gap-2 mb-3">
              {(['critical', 'high', 'medium', 'low'] as const).map(sev => severityCounts[sev] ? (
                <span key={sev} className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${severityColour[sev]}`}>
                  {severityCounts[sev]} {sev}
                </span>
              ) : null)}
            </div>
            <div className="space-y-2">
              {open.map(d => {
                const siteName = Array.isArray(d.sites) ? d.sites[0]?.name : d.sites?.name
                const assetName = Array.isArray(d.assets) ? d.assets[0]?.name : d.assets?.name
                return (
                  <div key={d.id} className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-md bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium text-eq-ink">{d.title}</p>
                          <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded border ${severityColour[d.severity] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {d.severity}
                          </span>
                        </div>
                        {d.description && <p className="text-xs text-eq-grey mt-1">{d.description}</p>}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-eq-grey">
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{siteName ?? '—'}</span>
                          {assetName && <span>· {assetName}</span>}
                          <span>· raised {formatDate(d.created_at)}</span>
                          {d.status === 'in_progress' && <StatusBadge status="in-progress" label="In progress" />}
                          {d.work_order_number && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">WO {d.work_order_number}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {recent.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-eq-ink mb-3">Recently resolved</h2>
          <Card>
            <div className="divide-y divide-gray-100">
              {recent.map(d => {
                const siteName = Array.isArray(d.sites) ? d.sites[0]?.name : d.sites?.name
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3 py-2 px-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-eq-ink truncate">{d.title}</p>
                      <p className="text-xs text-eq-grey">{siteName ?? '—'} · resolved {formatDate(d.resolved_at)}</p>
                    </div>
                    <StatusBadge status="complete" label="Resolved" />
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
