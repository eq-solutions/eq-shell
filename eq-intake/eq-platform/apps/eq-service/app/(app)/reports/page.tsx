import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ReportFilters } from './ReportFilters'
import { GenerateReportButton } from './GenerateReportButton'
import {
  computeMaintenanceCompliance,
  computeComplianceBySite,
} from '@/lib/analytics/site-health'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; site_id?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const customerId = params.customer_id ?? ''
  const siteId = params.site_id ?? ''
  const fromDate = params.from ?? ''
  const toDate = params.to ?? ''

  const supabase = await createClient()

  // Sites + Customers for filters
  const [{ data: sites }, { data: customers }] = await Promise.all([
    supabase.from('sites').select('id, name, customer_id').eq('is_active', true).order('name').limit(10000),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name').limit(10000),
  ])

  // If customer is selected, get their site IDs for filtering
  const customerSiteIds = customerId
    ? (sites ?? []).filter((s) => s.customer_id === customerId).map((s) => s.id)
    : null

  // ────────── Maintenance stats ──────────
  let mCheckQuery = supabase.from('maintenance_checks').select('id, status, due_date, completed_at, site_id').eq('is_active', true).limit(10000)
  if (siteId) {
    mCheckQuery = mCheckQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    mCheckQuery = mCheckQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) mCheckQuery = mCheckQuery.gte('due_date', fromDate)
  if (toDate) mCheckQuery = mCheckQuery.lte('due_date', toDate)

  const { data: checks } = await mCheckQuery

  // DB returns status as string; computeMaintenanceCompliance narrows
  // to CheckStatus. The function tolerates any string at runtime
  // (unknown statuses fall through to the default bucket). Cast to bridge.
  const maintenance = computeMaintenanceCompliance(checks as Parameters<typeof computeMaintenanceCompliance>[0])
  const mTotal = maintenance.total
  const mComplete = maintenance.complete
  const mOverdue = maintenance.overdue
  const mInProgress = maintenance.inProgress
  const mScheduled = maintenance.scheduled
  const mCancelled = maintenance.cancelled
  const mComplianceRate = maintenance.complianceRate

  // ────────── Testing stats ──────────
  let tRecordQuery = supabase.from('test_records').select('id, result, test_date, site_id').eq('is_active', true).limit(10000)
  if (siteId) {
    tRecordQuery = tRecordQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    tRecordQuery = tRecordQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) tRecordQuery = tRecordQuery.gte('test_date', fromDate)
  if (toDate) tRecordQuery = tRecordQuery.lte('test_date', toDate)

  const { data: tests } = await tRecordQuery

  const tTotal = tests?.length ?? 0
  const tPass = tests?.filter((t) => t.result === 'pass').length ?? 0
  const tFail = tests?.filter((t) => t.result === 'fail').length ?? 0
  const tDefect = tests?.filter((t) => t.result === 'defect').length ?? 0
  const tPending = tests?.filter((t) => t.result === 'pending').length ?? 0
  const tPassRate = tTotal > 0 ? Math.round((tPass / tTotal) * 100) : 0

  // ────────── Overdue checks per site (top 5) ──────────
  const overdueChecksBySite: Record<string, number> = {}
  for (const c of checks ?? []) {
    if (c.status === 'overdue' && c.site_id) {
      overdueChecksBySite[c.site_id] = (overdueChecksBySite[c.site_id] ?? 0) + 1
    }
  }
  const siteMap = Object.fromEntries((sites ?? []).map((s) => [s.id, s.name]))
  const topOverdueSites = Object.entries(overdueChecksBySite)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ site: siteMap[id] ?? id, count }))

  // ────────── Recent failed tests (last 10) ──────────
  const failedTests = (tests ?? [])
    .filter((t) => t.result === 'fail' || t.result === 'defect')
    .sort((a, b) => new Date(b.test_date).getTime() - new Date(a.test_date).getTime())
    .slice(0, 10)

  let failedTestDetails: { id: string; test_type: string; test_date: string; result: string; assets: { name: string } | null; sites: { name: string } | null }[] = []
  if (failedTests.length > 0) {
    const { data } = await supabase
      .from('test_records')
      .select('id, test_type, test_date, result, assets(name), sites(name)')
      .in('id', failedTests.map((t) => t.id))
      .order('test_date', { ascending: false })
    failedTestDetails = (data ?? []) as unknown as typeof failedTestDetails
  }

  // ────────── ACB / NSX workflow progress ──────────
  let acbQuery = supabase
    .from('acb_tests')
    .select('id, step1_status, step2_status, step3_status, overall_result, test_date, site_id')
    .eq('is_active', true)
    .limit(10000)
  if (siteId) {
    acbQuery = acbQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    acbQuery = acbQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) acbQuery = acbQuery.gte('test_date', fromDate)
  if (toDate) acbQuery = acbQuery.lte('test_date', toDate)
  const { data: acbTests } = await acbQuery

  let nsxQuery = supabase
    .from('nsx_tests')
    .select('id, step1_status, step2_status, step3_status, overall_result, test_date, site_id')
    .eq('is_active', true)
    .limit(10000)
  if (siteId) {
    nsxQuery = nsxQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    nsxQuery = nsxQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) nsxQuery = nsxQuery.gte('test_date', fromDate)
  if (toDate) nsxQuery = nsxQuery.lte('test_date', toDate)
  const { data: nsxTests } = await nsxQuery

  const countWorkflowProgress = (
    rows: { step1_status: string; step2_status: string; step3_status: string }[] | null,
  ) => {
    const out = { total: 0, notStarted: 0, inProgress: 0, complete: 0 }
    for (const r of rows ?? []) {
      out.total++
      const done =
        (r.step1_status === 'complete' ? 1 : 0) +
        (r.step2_status === 'complete' ? 1 : 0) +
        (r.step3_status === 'complete' ? 1 : 0)
      if (done === 3) out.complete++
      else if (done === 0) out.notStarted++
      else out.inProgress++
    }
    return out
  }

  // DB step_status columns are nullable; countWorkflowProgress treats null
  // the same as "not started" at runtime. Cast to bridge the type signature.
  const acbProgress = countWorkflowProgress(acbTests as Parameters<typeof countWorkflowProgress>[0])
  const nsxProgress = countWorkflowProgress(nsxTests as Parameters<typeof countWorkflowProgress>[0])

  // ────────── Defects register summary ──────────
  let defectQuery = supabase
    .from('defects')
    .select('id, severity, status, site_id, created_at')
    .limit(10000)
  if (siteId) {
    defectQuery = defectQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    defectQuery = defectQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) defectQuery = defectQuery.gte('created_at', fromDate)
  if (toDate) defectQuery = defectQuery.lte('created_at', toDate)
  const { data: defects } = await defectQuery

  const defectsTotal = defects?.length ?? 0
  const defectsOpen = defects?.filter((d) => d.status === 'open').length ?? 0
  const defectsInProgress = defects?.filter((d) => d.status === 'in_progress').length ?? 0
  const defectsResolved = defects?.filter((d) => d.status === 'resolved' || d.status === 'closed').length ?? 0
  const defectsCritical = defects?.filter((d) => d.severity === 'critical').length ?? 0
  const defectsHigh = defects?.filter((d) => d.severity === 'high').length ?? 0
  const defectsMedium = defects?.filter((d) => d.severity === 'medium').length ?? 0
  const defectsLow = defects?.filter((d) => d.severity === 'low').length ?? 0

  // ────────── Compliance by site (top 10 by maintenance volume) ──────────
  const complianceBySite = computeComplianceBySite(
    checks as Parameters<typeof computeComplianceBySite>[0],
    siteMap,
    10,
  ).map((r) => ({
    site: r.siteName,
    total: r.total,
    complete: r.complete,
    overdue: r.overdue,
    rate: r.rate,
  }))

  // ────────── Monthly trend (last 6 months) ──────────
  const now = new Date()
  const months: { key: string; label: string; tests: number; pass: number; checks: number; complete: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({
      key,
      label: d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      tests: 0,
      pass: 0,
      checks: 0,
      complete: 0,
    })
  }
  const monthIdx = (date: string) => {
    const d = new Date(date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return months.findIndex((m) => m.key === key)
  }
  for (const t of tests ?? []) {
    const idx = monthIdx(t.test_date)
    if (idx >= 0) {
      months[idx].tests++
      if (t.result === 'pass') months[idx].pass++
    }
  }
  for (const c of checks ?? []) {
    if (!c.due_date) continue
    const idx = monthIdx(c.due_date)
    if (idx >= 0) {
      months[idx].checks++
      if (c.status === 'complete') months[idx].complete++
    }
  }
  const maxTrendValue = Math.max(1, ...months.flatMap((m) => [m.tests, m.checks]))

  // Build filter description for report generation
  const selectedCustomer = customerId ? customers?.find((c) => c.id === customerId) : null
  const selectedSite = siteId ? sites?.find((s) => s.id === siteId) : null
  const filterDescription = [
    selectedCustomer ? selectedCustomer.name : null,
    selectedSite ? selectedSite.name : null,
    fromDate ? `from ${fromDate}` : null,
    toDate ? `to ${toDate}` : null,
  ].filter(Boolean).join(' — ') || 'All data'

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Reports' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Compliance Reports</h1>
      </div>

      {/* Filters + Generate Report */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <ReportFilters sites={sites ?? []} customers={customers ?? []} />
        <GenerateReportButton
          customerId={customerId}
          siteId={siteId}
          from={fromDate}
          to={toDate}
          filterDescription={filterDescription}
        />
      </div>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Maintenance Compliance</p>
          <p className={`text-3xl font-bold ${mComplianceRate >= 80 ? 'text-green-600' : mComplianceRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {mComplianceRate}%
          </p>
          <p className="text-xs text-eq-grey mt-1">{mComplete} of {mTotal} complete</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Overdue Checks</p>
          <p className={`text-3xl font-bold ${mOverdue > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {mOverdue}
          </p>
          <p className="text-xs text-eq-grey mt-1">requiring attention</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Test Pass Rate</p>
          <p className={`text-3xl font-bold ${tPassRate >= 80 ? 'text-green-600' : tPassRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {tPassRate}%
          </p>
          <p className="text-xs text-eq-grey mt-1">{tPass} of {tTotal} passed</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Test Defects</p>
          <p className={`text-3xl font-bold ${(tFail + tDefect) > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {tFail + tDefect}
          </p>
          <p className="text-xs text-eq-grey mt-1">{tFail} fail, {tDefect} defect</p>
        </Card>
      </div>

      {/* Two-column detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Maintenance breakdown */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Maintenance Check Breakdown</h2>
          <div className="space-y-3">
            <StatBar label="Complete" value={mComplete} total={mTotal} color="bg-green-500" />
            <StatBar label="In Progress" value={mInProgress} total={mTotal} color="bg-eq-sky" />
            <StatBar label="Scheduled" value={mScheduled} total={mTotal} color="bg-gray-300" />
            <StatBar label="Overdue" value={mOverdue} total={mTotal} color="bg-amber-500" />
            <StatBar label="Cancelled" value={mCancelled} total={mTotal} color="bg-gray-400" />
          </div>
        </Card>

        {/* Testing breakdown */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Test Result Breakdown</h2>
          <div className="space-y-3">
            <StatBar label="Pass" value={tPass} total={tTotal} color="bg-green-500" />
            <StatBar label="Pending" value={tPending} total={tTotal} color="bg-gray-300" />
            <StatBar label="Fail" value={tFail} total={tTotal} color="bg-red-500" />
            <StatBar label="Defect" value={tDefect} total={tTotal} color="bg-amber-500" />
          </div>
        </Card>
      </div>

      {/* Bottom tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Overdue by site */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Overdue Checks by Site</h2>
          {topOverdueSites.length === 0 ? (
            <p className="text-sm text-eq-grey">No overdue checks — all clear.</p>
          ) : (
            <div className="space-y-2">
              {topOverdueSites.map(({ site, count }) => (
                <div key={site} className="flex items-center justify-between text-sm">
                  <span className="text-eq-ink">{site}</span>
                  <span className="font-bold text-amber-600">{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent failed tests */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Recent Failed / Defect Tests</h2>
          {failedTestDetails.length === 0 ? (
            <p className="text-sm text-eq-grey">No failed tests in this period.</p>
          ) : (
            <div className="space-y-2">
              {failedTestDetails.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-eq-ink font-medium">{t.assets?.name ?? '—'}</span>
                    <span className="text-eq-grey text-xs ml-2">{t.test_type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-eq-grey">{new Date(t.test_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}</span>
                    <span className={`text-xs font-bold uppercase ${t.result === 'fail' ? 'text-red-600' : 'text-amber-600'}`}>
                      {t.result}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Breaker workflow progress */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">ACB Workflow Progress</h2>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <WorkflowStat label="Total" value={acbProgress.total} color="text-eq-ink" />
            <WorkflowStat label="Complete" value={acbProgress.complete} color="text-green-600" />
            <WorkflowStat label="In Progress" value={acbProgress.inProgress} color="text-eq-sky" />
            <WorkflowStat label="Not Started" value={acbProgress.notStarted} color="text-eq-grey" />
          </div>
          <div className="space-y-2">
            <StatBar label="Complete" value={acbProgress.complete} total={acbProgress.total} color="bg-green-500" />
            <StatBar label="In Progress" value={acbProgress.inProgress} total={acbProgress.total} color="bg-eq-sky" />
            <StatBar label="Not Started" value={acbProgress.notStarted} total={acbProgress.total} color="bg-gray-300" />
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">NSX Workflow Progress</h2>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <WorkflowStat label="Total" value={nsxProgress.total} color="text-eq-ink" />
            <WorkflowStat label="Complete" value={nsxProgress.complete} color="text-green-600" />
            <WorkflowStat label="In Progress" value={nsxProgress.inProgress} color="text-eq-sky" />
            <WorkflowStat label="Not Started" value={nsxProgress.notStarted} color="text-eq-grey" />
          </div>
          <div className="space-y-2">
            <StatBar label="Complete" value={nsxProgress.complete} total={nsxProgress.total} color="bg-green-500" />
            <StatBar label="In Progress" value={nsxProgress.inProgress} total={nsxProgress.total} color="bg-eq-sky" />
            <StatBar label="Not Started" value={nsxProgress.notStarted} total={nsxProgress.total} color="bg-gray-300" />
          </div>
        </Card>
      </div>

      {/* Defects register summary */}
      <Card>
        <h2 className="text-sm font-bold text-eq-ink mb-4">Defects Register Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase mb-1">Total Defects</p>
            <p className="text-2xl font-bold text-eq-ink">{defectsTotal}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase mb-1">Open</p>
            <p className="text-2xl font-bold text-red-600">{defectsOpen}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase mb-1">In Progress</p>
            <p className="text-2xl font-bold text-amber-600">{defectsInProgress}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase mb-1">Resolved</p>
            <p className="text-2xl font-bold text-green-600">{defectsResolved}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-eq-grey uppercase">By Severity</p>
            <StatBar label="Critical" value={defectsCritical} total={defectsTotal} color="bg-red-600" />
            <StatBar label="High" value={defectsHigh} total={defectsTotal} color="bg-red-400" />
            <StatBar label="Medium" value={defectsMedium} total={defectsTotal} color="bg-amber-500" />
            <StatBar label="Low" value={defectsLow} total={defectsTotal} color="bg-gray-400" />
          </div>
          <div className="text-xs text-eq-grey space-y-1">
            <p>Critical defects require immediate attention and escalation.</p>
            <p>High severity defects should be actioned within 7 days.</p>
            <p>Medium &amp; low may be scheduled in the next maintenance window.</p>
          </div>
        </div>
      </Card>

      {/* Compliance by site */}
      <Card>
        <h2 className="text-sm font-bold text-eq-ink mb-4">Maintenance Compliance by Site</h2>
        {complianceBySite.length === 0 ? (
          <p className="text-sm text-eq-grey">No maintenance data for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-bold text-eq-grey uppercase">
                  <th className="py-2 px-2">Site</th>
                  <th className="py-2 px-2 text-right">Total</th>
                  <th className="py-2 px-2 text-right">Complete</th>
                  <th className="py-2 px-2 text-right">Overdue</th>
                  <th className="py-2 px-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {complianceBySite.map((row) => (
                  <tr key={row.site} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-eq-ink">{row.site}</td>
                    <td className="py-2 px-2 text-right text-eq-grey">{row.total}</td>
                    <td className="py-2 px-2 text-right text-green-600 font-medium">{row.complete}</td>
                    <td className="py-2 px-2 text-right text-amber-600 font-medium">{row.overdue}</td>
                    <td className={`py-2 px-2 text-right font-bold ${row.rate >= 80 ? 'text-green-600' : row.rate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                      {row.rate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Monthly trend (last 6 months) */}
      <Card>
        <h2 className="text-sm font-bold text-eq-ink mb-1">6-Month Trend</h2>
        <p className="text-xs text-eq-grey mb-4">Tests run and maintenance checks due per month.</p>
        <div className="flex items-end gap-4 h-40">
          {months.map((m) => (
            <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center gap-1 h-32">
                <div
                  className="w-4 bg-eq-sky rounded-t"
                  style={{ height: `${(m.tests / maxTrendValue) * 100}%` }}
                  title={`${m.tests} tests (${m.pass} pass)`}
                />
                <div
                  className="w-4 bg-green-500 rounded-t"
                  style={{ height: `${(m.checks / maxTrendValue) * 100}%` }}
                  title={`${m.checks} checks (${m.complete} complete)`}
                />
              </div>
              <p className="text-xs text-eq-grey">{m.label}</p>
              <p className="text-[10px] text-eq-grey">{m.tests}/{m.checks}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-4 text-xs text-eq-grey">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-eq-sky rounded-sm" /> Tests run
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500 rounded-sm" /> Maintenance checks
          </div>
        </div>
      </Card>
    </div>
  )
}

function WorkflowStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center p-2 rounded-md bg-gray-50 border border-gray-100">
      <p className="text-xs font-bold text-eq-grey uppercase">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function StatBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-eq-grey">{label}</span>
        <span className="font-bold text-eq-ink">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
