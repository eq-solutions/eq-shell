import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { SearchFilter } from '@/components/ui/SearchFilter'
import Link from 'next/link'
import { DefectRow } from './DefectRow'

export default async function DefectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; site_id?: string; search?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  // Get current user for role check
  const { data: { user } } = await supabase.auth.getUser()
  let userRole = 'read_only'
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = membership?.role ?? 'read_only'
  }

  // Build query with filters
  let query = supabase
    .from('defects')
    .select(`
      id, title, description, severity, status,
      work_order_number, work_order_date,
      raised_by, assigned_to, resolved_at, resolved_by, resolution_notes,
      created_at, updated_at,
      assets(id, name),
      sites(id, name),
      maintenance_checks(id, custom_name)
    `)
    .order('created_at', { ascending: false })

  if (params.status) {
    query = query.eq('status', params.status)
  }
  if (params.severity) {
    query = query.eq('severity', params.severity)
  }
  if (params.site_id) {
    query = query.eq('site_id', params.site_id)
  }
  if (params.search) {
    query = query.ilike('title', `%${params.search}%`)
  }

  const [{ data: defects, error }, { data: sites }, countsRes] = await Promise.all([
    query.limit(200),
    supabase
      .from('sites')
      .select('id, name, customers(name)')
      .eq('is_active', true)
      .order('name'),
    Promise.all([
      supabase.from('defects').select('*', { count: 'exact', head: true }),
      supabase.from('defects').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('defects').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
      supabase.from('defects').select('*', { count: 'exact', head: true }).eq('status', 'resolved'),
      supabase.from('defects').select('*', { count: 'exact', head: true }).eq('status', 'closed'),
    ]),
  ])

  const [totalRes, openRes, inProgressRes, resolvedRes, closedRes] = countsRes

  // Fetch team members for assignment dropdown
  const { data: teamMembers } = await supabase
    .from('tenant_members')
    .select('user_id')
    .eq('is_active', true)

  const memberIds = (teamMembers ?? []).map((m) => m.user_id as string)
  let team: { id: string; name: string }[] = []
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', memberIds)
    team = (profiles ?? []).map((p) => ({
      id: p.id,
      name: p.full_name ?? p.email ?? 'Unknown',
    }))
  }

  const counts = {
    total: totalRes.count ?? 0,
    open: openRes.count ?? 0,
    inProgress: inProgressRes.count ?? 0,
    resolved: resolvedRes.count ?? 0,
    closed: closedRes.count ?? 0,
  }

  const canWrite = ['super_admin', 'admin', 'supervisor'].includes(userRole)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-eq-ink">Defects</h1>
        <p className="text-sm text-eq-grey mt-1">Track and resolve defects raised during maintenance and testing.</p>
      </div>

      {/* Status KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total', count: counts.total, href: '/defects', bg: 'bg-gray-50', text: 'text-eq-ink', active: !params.status },
          { label: 'Open', count: counts.open, href: '/defects?status=open', bg: 'bg-red-50', text: 'text-red-700', active: params.status === 'open' },
          { label: 'In Progress', count: counts.inProgress, href: '/defects?status=in_progress', bg: 'bg-amber-50', text: 'text-amber-700', active: params.status === 'in_progress' },
          { label: 'Resolved', count: counts.resolved, href: '/defects?status=resolved', bg: 'bg-green-50', text: 'text-green-700', active: params.status === 'resolved' },
          { label: 'Closed', count: counts.closed, href: '/defects?status=closed', bg: 'bg-gray-50', text: 'text-eq-grey', active: params.status === 'closed' },
        ].map(({ label, count, href, bg, text, active }) => (
          <Link key={label} href={href}>
            <div className={`${bg} rounded-xl p-3 text-center border ${active ? 'border-eq-sky ring-1 ring-eq-sky/20' : 'border-transparent'} hover:border-eq-sky/30 transition-all`}>
              <p className={`text-2xl font-bold ${text}`}>{count}</p>
              <p className="text-xs text-eq-grey mt-0.5">{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Filters */}
      <SearchFilter
        placeholder="Search defects..."
        filters={[
          {
            key: 'severity',
            label: 'All severities',
            options: [
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ],
          },
          {
            key: 'site_id',
            label: 'All sites',
            options: (sites ?? []).map((s) => {
              const rawCustomer = (s as { customers?: { name?: string } | { name?: string }[] | null }).customers
              const customer = Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer
              const label = customer?.name ? `${customer.name} — ${s.name}` : s.name
              return { value: s.id as string, label }
            }),
          },
        ]}
      />

      {/* Defect list */}
      <Card>
        {(!defects || defects.length === 0) ? (
          <div className="text-center py-12">
            <p className="text-sm text-eq-grey">No defects found{params.status ? ` with status "${params.status}"` : ''}.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {defects.map((defect) => (
              <DefectRow
                key={defect.id}
                defect={defect}
                team={team}
                canWrite={canWrite}
                currentUserId={user?.id ?? null}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
