import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { CalendarDays, MapPin } from 'lucide-react'
import { formatDate } from '@/lib/utils/format'

/**
 * Portal "Visits" page — combined upcoming + recently-completed list,
 * scoped to the customer's sites.
 */
export default async function PortalVisitsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/portal/login')

  const { data: customerIdRpc } = await supabase.rpc('get_portal_customer_id')
  const customerId = customerIdRpc as string | null
  if (!customerId) redirect('/portal/login')

  // Customer's sites — used as a filter scope for the maintenance_checks query.
  const { data: sitesRows } = await supabase
    .from('sites')
    .select('id, name')
    .eq('customer_id', customerId)
    .eq('is_active', true)
  const siteIds = ((sitesRows ?? []) as Array<{ id: string; name: string }>).map(s => s.id)
  if (siteIds.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <CalendarDays className="w-10 h-10 text-eq-grey mx-auto mb-2" />
          <p className="text-sm font-medium text-eq-ink">No visits yet</p>
        </div>
      </Card>
    )
  }

  const [upcomingRes, recentRes] = await Promise.all([
    supabase
      .from('maintenance_checks')
      .select('id, custom_name, status, due_date, sites(name), job_plans(name)')
      .in('site_id', siteIds)
      .in('status', ['scheduled', 'in_progress'])
      .eq('is_active', true)
      .order('due_date', { ascending: true })
      .limit(20),
    supabase
      .from('maintenance_checks')
      .select('id, custom_name, status, completed_at, due_date, sites(name), job_plans(name)')
      .in('site_id', siteIds)
      .eq('status', 'complete')
      .eq('is_active', true)
      .order('completed_at', { ascending: false })
      .limit(15),
  ])

  type Visit = {
    id: string
    custom_name: string | null
    status: string
    due_date: string
    completed_at?: string | null
    sites: { name: string } | { name: string }[] | null
    job_plans: { name: string } | { name: string }[] | null
  }
  const upcoming = (upcomingRes.data ?? []) as Visit[]
  const recent = (recentRes.data ?? []) as Visit[]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-eq-ink mb-3">Upcoming visits</h1>
        {upcoming.length === 0 ? (
          <Card><p className="text-sm text-eq-grey py-4 text-center">No visits currently scheduled.</p></Card>
        ) : (
          <div className="space-y-2">
            {upcoming.map(v => <VisitRow key={v.id} v={v} kind="upcoming" />)}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-base font-bold text-eq-ink mb-3">Recently completed</h2>
        {recent.length === 0 ? (
          <Card><p className="text-sm text-eq-grey py-4 text-center">No completed visits yet.</p></Card>
        ) : (
          <div className="space-y-2">
            {recent.map(v => <VisitRow key={v.id} v={v} kind="recent" />)}
          </div>
        )}
      </div>
    </div>
  )
}

function VisitRow({ v, kind }: {
  v: {
    id: string; custom_name: string | null; status: string
    due_date: string; completed_at?: string | null
    sites: { name: string } | { name: string }[] | null
    job_plans: { name: string } | { name: string }[] | null
  }
  kind: 'upcoming' | 'recent'
}) {
  const siteName = Array.isArray(v.sites) ? v.sites[0]?.name : v.sites?.name
  const jpName = Array.isArray(v.job_plans) ? v.job_plans[0]?.name : v.job_plans?.name
  const dateStr = kind === 'upcoming'
    ? formatDate(v.due_date)
    : (v.completed_at ? formatDate(v.completed_at) : '—')
  const isOverdue = v.status === 'overdue'

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-start gap-3">
      <div className="w-9 h-9 rounded-md bg-eq-ice/60 text-eq-deep flex items-center justify-center shrink-0">
        <CalendarDays className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-eq-ink truncate">{v.custom_name ?? jpName ?? 'Maintenance check'}</p>
          {kind === 'recent' ? (
            <StatusBadge status="complete" label="Done" />
          ) : isOverdue ? (
            <StatusBadge status="overdue" />
          ) : v.status === 'in_progress' ? (
            <StatusBadge status="in-progress" label="In progress" />
          ) : (
            <StatusBadge status="active" label="Scheduled" />
          )}
        </div>
        <p className="text-xs text-eq-grey mt-0.5 flex items-center gap-1.5">
          <MapPin className="w-3 h-3" />
          {siteName ?? '—'}
          <span className="mx-1">·</span>
          <span>{dateStr}</span>
        </p>
      </div>
    </div>
  )
}
