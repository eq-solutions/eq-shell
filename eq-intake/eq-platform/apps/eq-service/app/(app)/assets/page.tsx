import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { AssetList } from './AssetList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

const DEFAULT_PER_PAGE = 25
const ALLOWED_PER_PAGE = [25, 50, 100, 250]

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; site_id?: string; customer_id?: string; asset_type?: string; job_plan_id?: string; page?: string; per_page?: string; show_archived?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const siteId = params.site_id ?? ''
  const customerId = params.customer_id ?? ''
  const assetType = params.asset_type ?? ''
  const jobPlanId = params.job_plan_id ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const requestedPerPage = parseInt(params.per_page ?? String(DEFAULT_PER_PAGE), 10)
  const perPage = ALLOWED_PER_PAGE.includes(requestedPerPage) ? requestedPerPage : DEFAULT_PER_PAGE
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

  // Fetch sites for filter dropdown (include customer so dropdowns can
  // disambiguate duplicate site codes across customers)
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, code, customer_id, customers(name)')
    .eq('is_active', true)
    .order('name')

  // Fetch customers for the customer filter dropdown
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Fetch distinct asset types via RPC — selecting raw rows hits PostgREST's
  // 1000-row cap and would silently drop types that only exist beyond that.
  const { data: typeRows } = await supabase.rpc('get_distinct_asset_types')
  const assetTypes = ((typeRows ?? []) as Array<{ asset_type: string }>)
    .map((r) => r.asset_type)
    .filter(Boolean)

  // Build assets query (join job_plans for display)
  let query = supabase
    .from('assets')
    .select('*, sites(name), job_plans(name, code)', { count: 'exact' })
    .order('name')

  if (!showArchived) {
    query = query.eq('is_active', true)
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,asset_type.ilike.%${search}%,serial_number.ilike.%${search}%,maximo_id.ilike.%${search}%,location.ilike.%${search}%`)
  }
  if (siteId) {
    query = query.eq('site_id', siteId)
  }
  if (customerId) {
    const customerSiteIds = (sites ?? [])
      .filter((s) => s.customer_id === customerId)
      .map((s) => s.id)
    if (customerSiteIds.length > 0) {
      query = query.in('site_id', customerSiteIds)
    } else {
      // No sites for this customer — return zero rows.
      query = query.eq('site_id', '00000000-0000-0000-0000-000000000000')
    }
  }
  if (assetType) {
    query = query.eq('asset_type', assetType)
  }
  if (jobPlanId) {
    query = query.eq('job_plan_id', jobPlanId)
  }

  const from = (page - 1) * perPage
  const to = from + perPage - 1
  query = query.range(from, to)

  const { data: assets, count } = await query
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  // Fetch ALL assets for the grouped view via RPC. PostgREST's
  // db-max-rows cap (1000) is enforced on any row-set response, so
  // selecting raw rows — even with .range(0, 49999) — silently
  // truncates. Returning a single scalar jsonb from an RPC bypasses
  // the cap because the response is one value, not a row set.
  // The generated RPC signature types the optional filters as `string`
  // (non-nullable) but the Postgres function declares them as `text` with
  // default null. Passing null at runtime is correct (server treats null as
  // "no filter") — cast to satisfy the stricter generated type.
  const { data: allAssetsJson } = await supabase.rpc('get_assets_for_grouping', {
    p_show_archived: showArchived,
    p_search: (search || null) as unknown as string,
    p_site_id: (siteId || null) as unknown as string,
    p_asset_type: (assetType || null) as unknown as string,
    p_job_plan_id: (jobPlanId || null) as unknown as string,
    p_customer_id: (customerId || null) as unknown as string,
  })
  const allAssets = (allAssetsJson ?? []) as unknown[]

  // Fetch all maintenance plans for the form dropdown
  const { data: allJobPlans } = await supabase
    .from('job_plans')
    .select('id, name, code, type')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Assets' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Assets</h1>
      </div>
      <AssetList
        assets={(assets ?? []) as never}
        allAssets={(allAssets ?? []) as never}
        sites={sites ?? []}
        customers={customers ?? []}
        assetTypes={assetTypes}
        allJobPlans={(allJobPlans ?? []) as { id: string; name: string; code: string | null; type: string | null }[]}
        page={page}
        totalPages={totalPages}
        total={total}
        perPage={perPage}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
