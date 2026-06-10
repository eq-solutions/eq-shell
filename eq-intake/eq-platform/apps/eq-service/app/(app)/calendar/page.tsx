import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { PmCalendarView } from '../pm-calendar/PmCalendarView'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, PmCalendarEntry, Site } from '@/lib/types'
import { formatSiteLabel } from '@/lib/utils/format'

const PER_PAGE = 25

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string
    site?: string
    category?: string
    quarter?: string
    fy?: string
    status?: string
    page?: string
    show_archived?: string
    view?: string
  }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const siteFilter = params.site ?? ''
  const categoryFilter = params.category ?? ''
  const quarterFilter = params.quarter ?? ''
  const fyFilter = params.fy ?? ''
  const statusFilter = params.status ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const showArchived = params.show_archived === '1'
  // Default to the month-grid calendar view (Sprint 4.2, 26-Apr decision).
  // Royce: "calendar-feeling" — leads with the visual that looks most like a
  // calendar. Users can switch to list/quarterly via the toolbar toggle.
  const viewMode = (params.view ?? 'calendar') as 'list' | 'calendar' | 'quarterly'

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
  const { data: sitesRaw } = await supabase
    .from('sites')
    .select('id, name, code, address, customers(id, name)')
    .eq('is_active', true)
    .order('name')
  const sites = (sitesRaw ?? []) as (Pick<Site, 'id' | 'name' | 'code' | 'address'> & {
    customers?: { id?: string | null; name?: string | null } | { id?: string | null; name?: string | null }[] | null
  })[]

  // Build query
  let query = supabase
    .from('pm_calendar')
    .select('*', { count: 'exact' })
    .order('start_time', { ascending: true })

  if (!showArchived) query = query.eq('is_active', true)
  if (siteFilter) query = query.eq('site_id', siteFilter)
  if (categoryFilter) query = query.eq('category', categoryFilter)
  if (quarterFilter) query = query.eq('quarter', quarterFilter)
  if (fyFilter) query = query.eq('financial_year', fyFilter)
  if (statusFilter) query = query.eq('status', statusFilter)

  // For calendar/quarterly views, fetch all; for list view, paginate
  if (viewMode === 'list') {
    const from = (page - 1) * PER_PAGE
    const to = from + PER_PAGE - 1
    query = query.range(from, to)
  } else {
    query = query.limit(500)
  }

  const { data: entriesRaw, count } = await query
  const total = count ?? 0
  const totalPages = viewMode === 'list' ? Math.ceil(total / PER_PAGE) : 1

  // Build site name map for display (customer · code - name)
  const siteMap: Record<string, string> = {}
  for (const s of sites) {
    siteMap[s.id] = formatSiteLabel(s)
  }

  const entries = (entriesRaw ?? []).map((e) => ({
    ...(e as PmCalendarEntry),
    site_name: e.site_id ? (siteMap[e.site_id as string] ?? 'Unknown') : '—',
  }))

  // Client-side search filter
  const filtered = search
    ? entries.filter((e) => {
        const q = search.toLowerCase()
        return (
          e.title.toLowerCase().includes(q) ||
          (e.location ?? '').toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.site_name ?? '').toLowerCase().includes(q)
        )
      })
    : entries

  // Get distinct categories and FYs for filters
  const { data: catsRaw } = await supabase
    .from('pm_calendar')
    .select('category')
    .eq('is_active', true)
    .limit(200)
  const uniqueCategories = [...new Set((catsRaw ?? []).map((c) => c.category as string))].sort()

  const { data: fysRaw } = await supabase
    .from('pm_calendar')
    .select('financial_year')
    .eq('is_active', true)
    .not('financial_year', 'is', null)
    .limit(200)
  const uniqueFYs = [...new Set((fysRaw ?? []).map((f) => f.financial_year as string))].sort()

  // Fetch technicians for the form assigned_to dropdown.
  // Also collect admin + supervisor emails for the notification recipients
  // checklist (these are who can receive the supervisor digest).
  const { data: members } = await supabase
    .from('tenant_members')
    .select('user_id, role')
    .eq('is_active', true)
  const memberIds = (members ?? []).map((m) => m.user_id)
  const adminUserIds = new Set(
    (members ?? [])
      .filter((m) => ['super_admin', 'admin', 'supervisor'].includes(m.role as string))
      .map((m) => m.user_id),
  )
  let technicians: { id: string; email: string; full_name: string | null }[] = []
  let notificationRecipients: { email: string; name: string | null }[] = []
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', memberIds)
      .eq('is_active', true)
      .order('full_name')
    technicians = (profiles ?? []) as typeof technicians
    notificationRecipients = (profiles ?? [])
      .filter((p) => adminUserIds.has(p.id))
      .map((p) => ({ email: p.email as string, name: p.full_name as string | null }))
  }

  // Fetch known locations per site — pull distinct values from existing
  // assets and past calendar entries so the form can offer suggestions for
  // the location field as the user picks a site.
  const [{ data: assetLocations }, { data: entryLocations }] = await Promise.all([
    supabase
      .from('assets')
      .select('site_id, location')
      .eq('is_active', true)
      .not('location', 'is', null)
      .limit(2000),
    supabase
      .from('pm_calendar')
      .select('site_id, location')
      .eq('is_active', true)
      .not('location', 'is', null)
      .limit(2000),
  ])
  const siteLocations: Record<string, string[]> = {}
  for (const row of [...(assetLocations ?? []), ...(entryLocations ?? [])]) {
    const sid = row.site_id as string | null
    const loc = (row.location as string | null)?.trim()
    if (!sid || !loc) continue
    if (!siteLocations[sid]) siteLocations[sid] = []
    if (!siteLocations[sid].includes(loc)) siteLocations[sid].push(loc)
  }
  for (const sid of Object.keys(siteLocations)) {
    siteLocations[sid].sort((a, b) => a.localeCompare(b))
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Calendar' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Calendar</h1>
        <p className="text-sm text-eq-grey mt-1">
          PM planning across all sites — month-grid by default, with status overlays so you spot what Outlook can&apos;t (overdue, due-soon, completed).
        </p>
      </div>
      <PmCalendarView
        entries={filtered}
        sites={sites}
        categories={uniqueCategories}
        financialYears={uniqueFYs}
        technicians={technicians}
        notificationRecipients={notificationRecipients}
        siteLocations={siteLocations}
        page={page}
        totalPages={totalPages}
        viewMode={viewMode}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
