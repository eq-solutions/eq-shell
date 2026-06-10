import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { MaintenanceList } from './MaintenanceList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, MaintenanceCheckItem } from '@/lib/types'

const PER_PAGE = 25

type ListView = 'mine' | 'all'

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; site_id?: string; status?: string; kind?: string; view?: string; page?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const siteId = params.site_id ?? ''
  const status = params.status ?? ''
  const kind = params.kind ?? ''
  const viewParam = params.view ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

  const supabase = await createClient()

  // Get current user + role
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

  // Mine / All view (UX audit PR #149 §2.4 — locked 2026-05-18).
  // A brand-new tech landing on /maintenance shouldn't see the whole
  // tenant. Default to 'mine' for technicians; everyone else defaults
  // to 'all' but can flip via the toggle. URL param wins for explicit
  // navigation (e.g. from a "View all overdue" link).
  const defaultView: ListView = userRole === 'technician' ? 'mine' : 'all'
  const effectiveView: ListView =
    viewParam === 'mine' || viewParam === 'all' ? (viewParam as ListView) : defaultView
  const filterByUser = effectiveView === 'mine' && Boolean(user)

  // Fetch sites for filter (include customer_id for scope lookup, customer
  // name to disambiguate duplicate site codes across customers)
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, code, customer_id, customers(name)')
    .eq('is_active', true)
    .order('name')

  // Fetch customers — Customer-above-Site dropdown on the New Check form
  // (Royce 2026-05-19: pick customer first to narrow a long site list).
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Fetch active maintenance plans for create form. Includes site_id +
  // customer_id so the form can scope-filter (global / customer-scoped /
  // site-scoped). The deeper asset-level filter happens in the form
  // (see `useMemo` on filtered plans).
  const { data: jobPlans } = await supabase
    .from('job_plans')
    .select('id, name, code, site_id, customer_id')
    .eq('is_active', true)
    .order('name')

  // Fetch assets-to-plan links so the New Check form can filter the
  // Maintenance Plans list to plans actually used at the selected site
  // (Royce 2026-05-19 — "only for active assets for that site"). We send
  // a flat array of `{site_id, job_plan_id}` pairs; the form does the
  // distinct() on the client.
  const { data: siteAssetPlans } = await supabase
    .from('assets')
    .select('site_id, job_plan_id')
    .eq('is_active', true)
    .not('job_plan_id', 'is', null)

  // Fetch tenant members WITH role so the dropdown can show role +
  // sort by role hierarchy. The previous query stripped role at the
  // tenant_members layer, then re-fetched profiles — that's the same
  // data path, just losing the role context. Royce 2026-05-19: the
  // assignee dropdown was hiding inactive members AND not surfacing
  // role, which made it look "filtered".
  const { data: members } = await supabase
    .from('tenant_members')
    .select('user_id, role, is_active')

  // Role hierarchy for the sort order in the assignee dropdown. Admins
  // first (likely owner), then supervisors, then technicians. Inactive
  // members get a separate bucket at the bottom with an "(inactive)"
  // suffix so the user can see they exist but can't pick them.
  const ROLE_ORDER: Record<string, number> = {
    super_admin: 0,
    admin: 1,
    supervisor: 2,
    technician: 3,
    read_only: 4,
  }

  const activeMemberIds = (members ?? []).filter((m) => m.is_active).map((m) => m.user_id)
  let technicians: {
    id: string
    email: string
    full_name: string | null
    role: string | null
    is_active: boolean
  }[] = []
  if (activeMemberIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', activeMemberIds)
      .eq('is_active', true)
      .order('full_name')
    const memberRoleMap = new Map(
      (members ?? []).map((m) => [m.user_id, { role: m.role as string, is_active: m.is_active as boolean }])
    )
    technicians = (profiles ?? [])
      .map((p) => {
        const info = memberRoleMap.get(p.id)
        return {
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          role: info?.role ?? null,
          is_active: info?.is_active ?? false,
        }
      })
      .sort((a, b) => {
        const ar = ROLE_ORDER[a.role ?? 'read_only'] ?? 99
        const br = ROLE_ORDER[b.role ?? 'read_only'] ?? 99
        if (ar !== br) return ar - br
        return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email)
      })
  }

  // Fetch contract scope items for current FY (for scope indicator on check creation)
  const now = new Date()
  const fyYear = now.getMonth() + 1 < 7 ? now.getFullYear() - 1 : now.getFullYear()
  const currentFY = `${fyYear}-${fyYear + 1}`
  const { data: scopeItems } = await supabase
    .from('contract_scopes')
    .select('id, customer_id, site_id, scope_item, is_included, notes, financial_year')
    .eq('financial_year', currentFY)

  // Build checks query — hide archived (is_active=false) by default
  let query = supabase
    .from('maintenance_checks')
    .select('*, job_plans(name), sites(name), maintenance_check_items(count)', { count: 'exact' })
    .eq('is_active', true)
    .order('due_date', { ascending: true })

  if (search) {
    // Search by maintenance plan name — need to filter after fetch or use a join. For now, fetch all.
    // We'll filter client-side for search since it's across a join.
  }
  if (siteId) {
    query = query.eq('site_id', siteId)
  }
  if (status) {
    query = query.eq('status', status)
  }
  if (kind) {
    // Server-side kind filter — wired to the new "Type" dropdown on the
    // maintenance list (2026-04-28 chrome polish).
    query = query.eq('kind', kind)
  }
  if (filterByUser && user) {
    // Mine view — only checks assigned to the current user. Wired in
    // PR A (2026-05-19) so a tech's /maintenance list lands on their
    // own work, not the tenant-wide register.
    query = query.eq('assigned_to', user.id)
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: checksRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Map item counts and resolve assignee names
  const assigneeIds = [...new Set((checksRaw ?? []).map((c) => c.assigned_to).filter((id): id is string => Boolean(id)))]
  let assigneeMap: Record<string, string> = {}
  if (assigneeIds.length > 0) {
    const { data: assigneeProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', assigneeIds)
    for (const p of assigneeProfiles ?? []) {
      assigneeMap[p.id] = p.full_name ?? p.email
    }
  }

  const checks = (checksRaw ?? []).map((c) => {
    const itemAgg = c.maintenance_check_items as unknown as { count: number }[] | null
    const itemCount = itemAgg?.[0]?.count ?? 0
    return {
      ...c,
      maintenance_check_items: undefined,
      item_count: itemCount,
      completed_count: 0, // Will be calculated below
      assignee_name: c.assigned_to ? (assigneeMap[c.assigned_to] ?? null) : null,
    }
  })

  // Fetch all check items for visible checks (for completed counts + kanban)
  const checkIds = checks.map((c) => c.id)
  let itemsMap: Record<string, MaintenanceCheckItem[]> = {}
  if (checkIds.length > 0) {
    const { data: allItems } = await supabase
      .from('maintenance_check_items')
      .select('*')
      .in('check_id', checkIds)
      .order('sort_order')
      .limit(10000)

    itemsMap = (allItems ?? []).reduce((acc, item) => {
      const key = item.check_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(item as MaintenanceCheckItem)
      return acc
    }, {} as Record<string, MaintenanceCheckItem[]>)

    // Update completed counts
    for (const c of checks) {
      const items = itemsMap[c.id] ?? []
      c.completed_count = items.filter((i) => i.result !== null).length
    }
  }

  // Filter by search (across maintenance plan name) — client-side fallback
  const filteredChecks = search
    ? checks.filter((c) => {
        const jpName = (c.job_plans as { name: string } | null)?.name ?? ''
        const siteName = (c.sites as { name: string } | null)?.name ?? ''
        const q = search.toLowerCase()
        return jpName.toLowerCase().includes(q) || siteName.toLowerCase().includes(q)
      })
    : checks

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Maintenance' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Maintenance Checks</h1>
      </div>
      <MaintenanceList
        checks={filteredChecks as never}
        itemsMap={itemsMap}
        jobPlans={(jobPlans ?? []) as never}
        sites={sites ?? []}
        customers={customers ?? []}
        siteAssetPlans={(siteAssetPlans ?? []) as { site_id: string; job_plan_id: string }[]}
        technicians={technicians}
        scopeItems={(scopeItems ?? []) as never}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
        view={effectiveView}
      />
    </div>
  )
}
