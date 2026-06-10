import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { SiteList } from './SiteList'
import { isAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

const PER_PAGE = 25

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; customer_id?: string; page?: string; show_archived?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const customerId = params.customer_id ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const showArchived = params.show_archived === '1'

  const supabase = await createClient()

  // Get current user role
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

  // Fetch customers for filter dropdown
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Build sites query with joined customer name.
  // NOTE: do NOT use the PostgREST embedded `assets(count)` here — it does
  // not respect `is_active`, so archived assets get counted and the total
  // diverges from the /assets page and dashboard KPI. We fetch active-only
  // counts in a separate query below.
  let query = supabase
    .from('sites')
    .select('*, customers(name, logo_url)', { count: 'exact' })
    .order('name')

  if (!showArchived) {
    query = query.eq('is_active', true)
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
  }
  if (customerId) {
    query = query.eq('customer_id', customerId)
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: sitesRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Fetch active asset counts per site in a second query so `is_active`
  // is respected. Scoped to the paginated site IDs to keep payload small.
  const siteIds = (sitesRaw ?? []).map((s) => s.id as string)
  const countMap = new Map<string, number>()
  if (siteIds.length > 0) {
    // Use an RPC because PostgREST has a hard db-max-rows cap (1000)
    // that .range() cannot override — counting raw rows is broken on
    // any tenant with >1000 active assets. Aggregating in SQL returns
    // one row per site instead, well under the cap.
    const { data: countRows } = await supabase
      .rpc('get_active_asset_counts_by_site', { p_site_ids: siteIds })
    for (const row of (countRows ?? []) as Array<{ site_id: string; asset_count: number }>) {
      countMap.set(row.site_id, Number(row.asset_count))
    }
  }

  const sites = (sitesRaw ?? []).map((s) => ({
    ...s,
    asset_count: countMap.get(s.id as string) ?? 0,
  }))

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Sites' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Sites</h1>
      </div>
      <SiteList
        sites={sites as never}
        customers={customers ?? []}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
      />
    </div>
  )
}
