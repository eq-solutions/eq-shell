import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { JobPlanList } from './JobPlanList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, JobPlanItem } from '@/lib/types'

const PER_PAGE = 25

export default async function JobPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; site_id?: string; customer_id?: string; page?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const siteId = params.site_id ?? ''
  const customerId = params.customer_id ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

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

  // Fetch sites for filter dropdown (include code + customer so dropdowns
  // can disambiguate duplicate site codes across customers)
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

  // Build maintenance plans query with item count
  let query = supabase
    .from('job_plans')
    .select('*, sites(name), customers(name), job_plan_items(count)', { count: 'exact' })
    .order('name')

  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,type.ilike.%${search}%,description.ilike.%${search}%`)
  }
  if (siteId) {
    query = query.eq('site_id', siteId)
  }
  if (customerId) {
    // Show plans scoped to this customer OR scoped to any of its sites
    const customerSiteIds = (sites ?? [])
      .filter((s) => s.customer_id === customerId)
      .map((s) => s.id)
    if (customerSiteIds.length > 0) {
      query = query.or(`customer_id.eq.${customerId},site_id.in.(${customerSiteIds.join(',')})`)
    } else {
      query = query.eq('customer_id', customerId)
    }
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: jobPlansRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Map item counts
  const jobPlans = (jobPlansRaw ?? []).map((jp) => {
    const itemAgg = jp.job_plan_items as unknown as { count: number }[] | null
    return {
      ...jp,
      job_plan_items: undefined,
      item_count: itemAgg?.[0]?.count ?? 0,
    }
  })

  // Fetch all items for the visible maintenance plans (for the edit panel)
  const jpIds = jobPlans.map((jp) => jp.id)
  let itemsMap: Record<string, JobPlanItem[]> = {}
  if (jpIds.length > 0) {
    const { data: allItems } = await supabase
      .from('job_plan_items')
      .select('*')
      .in('job_plan_id', jpIds)
      .order('sort_order')

    itemsMap = (allItems ?? []).reduce((acc, item) => {
      const key = item.job_plan_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(item as JobPlanItem)
      return acc
    }, {} as Record<string, JobPlanItem[]>)
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Maintenance Plans' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Maintenance Plans</h1>
      </div>
      <JobPlanList
        jobPlans={jobPlans as never}
        sites={sites ?? []}
        customers={customers ?? []}
        itemsMap={itemsMap}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
