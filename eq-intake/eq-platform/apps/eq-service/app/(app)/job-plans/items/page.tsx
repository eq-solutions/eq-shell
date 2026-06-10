import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { JobPlanItemsRegister } from './JobPlanItemsRegister'
import { canWrite } from '@/lib/utils/roles'
import type { Role, JobPlanItem } from '@/lib/types'

/**
 * Master register of maintenance plan items across every plan.
 * Flattens job_plan_items joined to job_plans (and site name) so the user
 * can answer "what runs annually across the whole estate?" in one place.
 *
 * Server-side: pull everything for the tenant in one query then hand off to
 * the client component for filtering / sorting / CSV export. We are not
 * paginating because the master list is small enough (<5k rows realistically)
 * and the user explicitly wants the global view in one screen.
 */
export default async function JobPlanItemsRegisterPage() {
  const supabase = await createClient()

  // Resolve the user's role for the inline-edit gate.
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

  // Pull every active item with parent plan + site, ordered for predictable
  // grouping. RLS filters by tenant for us.
  const { data, error } = await supabase
    .from('job_plan_items')
    .select(`
      id,
      job_plan_id,
      description,
      sort_order,
      is_required,
      dark_site,
      freq_monthly,
      freq_quarterly,
      freq_semi_annual,
      freq_annual,
      freq_2yr,
      freq_3yr,
      freq_5yr,
      freq_8yr,
      freq_10yr,
      job_plans!inner ( id, name, code, type, site_id, is_active, sites ( id, name ) )
    `)
    .order('job_plan_id', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Maintenance Plans', href: '/job-plans' }, { label: 'Items Register' }]} />
        <h1 className="text-3xl font-bold text-eq-sky">Items Register</h1>
        <p className="text-sm text-red-600">Failed to load: {error.message}</p>
      </div>
    )
  }

  // Flatten the join into a row shape the client component is happy with.
  type Row = JobPlanItem & {
    plan_id: string
    plan_name: string
    plan_code: string | null
    plan_type: string | null
    plan_active: boolean
    site_id: string | null
    site_name: string | null
  }

  type RawRow = {
    id: string
    job_plan_id: string
    description: string
    sort_order: number
    is_required: boolean
    dark_site: boolean
    freq_monthly: boolean
    freq_quarterly: boolean
    freq_semi_annual: boolean
    freq_annual: boolean
    freq_2yr: boolean
    freq_3yr: boolean
    freq_5yr: boolean
    freq_8yr: boolean
    freq_10yr: boolean
    job_plans: {
      id: string
      name: string
      code: string | null
      type: string | null
      site_id: string | null
      is_active: boolean
      sites: { id: string; name: string } | null
    } | null
  }

  const rows: Row[] = ((data ?? []) as unknown as RawRow[])
    .filter((r) => r.job_plans?.is_active !== false) // hide items on deactivated plans
    .map((r) => ({
      // JobPlanItem fields — tenant_id and timestamps are not needed in the UI
      // so we satisfy the type with empty strings (the register never writes
      // them back).
      id: r.id,
      tenant_id: '',
      job_plan_id: r.job_plan_id,
      asset_id: null,
      description: r.description,
      sort_order: r.sort_order,
      is_required: r.is_required,
      dark_site: r.dark_site,
      freq_monthly: r.freq_monthly,
      freq_quarterly: r.freq_quarterly,
      freq_semi_annual: r.freq_semi_annual,
      freq_annual: r.freq_annual,
      freq_2yr: r.freq_2yr,
      freq_3yr: r.freq_3yr,
      freq_5yr: r.freq_5yr,
      freq_8yr: r.freq_8yr,
      freq_10yr: r.freq_10yr,
      created_at: '',
      updated_at: '',
      // joined fields
      plan_id: r.job_plans?.id ?? r.job_plan_id,
      plan_name: r.job_plans?.name ?? '—',
      plan_code: r.job_plans?.code ?? null,
      plan_type: r.job_plans?.type ?? null,
      plan_active: r.job_plans?.is_active ?? true,
      site_id: r.job_plans?.site_id ?? null,
      site_name: r.job_plans?.sites?.name ?? null,
    }))

  // Build the unique site list for the filter dropdown.
  const siteMap = new Map<string, string>()
  for (const r of rows) {
    if (r.site_id && r.site_name) siteMap.set(r.site_id, r.site_name)
  }
  const siteOptions = Array.from(siteMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Maintenance Plans', href: '/job-plans' }, { label: 'Items Register' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Maintenance Plan Items Register</h1>
        <p className="text-sm text-eq-grey mt-1">
          Master list of every task across every active maintenance plan with frequency, required, and reference image at a glance.
        </p>
      </div>
      <JobPlanItemsRegister rows={rows} sites={siteOptions} canWrite={canWrite(userRole)} />
    </div>
  )
}
