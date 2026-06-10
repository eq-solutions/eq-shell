/**
 * Testing Summary — shows testing checks (grouped maintenance events)
 * with expandable rows showing individual asset progress.
 *
 * Each check groups multiple ACB/NSX tests under one named event
 * e.g. "SY1 Annual E1.25 April 2026"
 */

import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import Link from 'next/link'
import { CheckSummaryTable } from './CheckSummaryTable'
import type { CheckRow, AssetRow } from './CheckSummaryTable'
import { formatSiteLabel } from '@/lib/utils/format'

function acbProgress(test: { step1_status: string | null; step2_status: string | null; step3_status: string | null }): number {
  let done = 0
  if (test.step1_status === 'complete') done++
  if (test.step2_status === 'complete') done++
  if (test.step3_status === 'complete') done++
  return Math.round((done / 3) * 100)
}

function acbStatus(test: { step1_status: string | null; step2_status: string | null; step3_status: string | null }): string {
  const pct = acbProgress(test)
  if (pct === 100) return 'complete'
  if (pct > 0) return 'in-progress'
  return 'not-started'
}

export default async function TestingSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ site_id?: string; kind?: string; status?: string; from?: string; to?: string; created?: string }>
}) {
  const params = await searchParams
  const siteId = params.site_id ?? ''
  const kindFilter = params.kind ?? ''
  const statusFilter = params.status ?? ''
  const createdCheckId = params.created ?? ''

  const supabase = await createClient()

  // Sites for filter (include code + customer so dropdowns can disambiguate
  // duplicate site codes across customers)
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, code, customers(name)')
    .eq('is_active', true)
    .order('name')

  const siteMap = Object.fromEntries((sites ?? []).map((s) => [s.id, s.name]))

  // Fetch test-bench checks. Post-merge (migration 0080) these live in
  // maintenance_checks with kind in (acb/nsx/general); the legacy
  // testing_checks view also resolves but we query the source table
  // directly for clarity and so kindFilter targets the canonical column.
  let checksQuery = supabase
    .from('maintenance_checks')
    .select('id, site_id, kind, frequency, custom_name, status, start_date, due_date, created_at')
    .eq('is_active', true)
    .in('kind', ['acb', 'nsx', 'general'])
    .order('created_at', { ascending: false })

  if (siteId) checksQuery = checksQuery.eq('site_id', siteId)
  if (kindFilter) checksQuery = checksQuery.eq('kind', kindFilter.toLowerCase())
  if (statusFilter) checksQuery = checksQuery.eq('status', statusFilter)

  const { data: checks } = await checksQuery

  // For each check, fetch associated tests + assets
  const checkRows: CheckRow[] = []

  for (const check of checks ?? []) {
    const assets: AssetRow[] = []
    let completedCount = 0
    let inProgressCount = 0

    if (check.kind === 'acb') {
      const { data: tests } = await supabase
        .from('acb_tests')
        .select('id, asset_id, step1_status, step2_status, step3_status, assets(id, name, asset_type, serial_number)')
        .eq('check_id', check.id)
        .eq('is_active', true)

      for (const t of tests ?? []) {
        const assetRaw = t.assets as unknown
        const asset = (Array.isArray(assetRaw) ? assetRaw[0] : assetRaw) as { id: string; name: string; asset_type: string; serial_number: string | null } | null
        const pct = acbProgress(t)
        const st = acbStatus(t)
        if (st === 'complete') completedCount++
        else if (st === 'in-progress') inProgressCount++
        const assetId = asset?.id ?? (t.asset_id as string)
        const siteQ = check.site_id ? `&site_id=${check.site_id}` : ''
        assets.push({
          id: assetId,
          test_id: t.id as string,
          asset_name: asset?.name ?? '—',
          asset_type: asset?.asset_type ?? '',
          serial_number: asset?.serial_number ?? null,
          progress: pct,
          status: st,
          detail_href: `/testing/acb?asset_id=${assetId}${siteQ}`,
        })
      }
    } else if (check.kind === 'nsx') {
      const { data: tests } = await supabase
        .from('nsx_tests')
        .select('id, asset_id, step1_status, step2_status, step3_status, overall_result, assets(id, name, asset_type, serial_number)')
        .eq('check_id', check.id)
        .eq('is_active', true)

      for (const t of tests ?? []) {
        const assetRaw = t.assets as unknown
        const asset = (Array.isArray(assetRaw) ? assetRaw[0] : assetRaw) as { id: string; name: string; asset_type: string; serial_number: string | null } | null
        // NSX uses same 3-step pattern
        const pct = acbProgress(t)
        const st = acbStatus(t)
        if (st === 'complete') completedCount++
        else if (st === 'in-progress') inProgressCount++
        const assetId = asset?.id ?? (t.asset_id as string)
        const siteQ = check.site_id ? `&site_id=${check.site_id}` : ''
        assets.push({
          id: assetId,
          test_id: t.id as string,
          asset_name: asset?.name ?? '—',
          asset_type: asset?.asset_type ?? '',
          serial_number: asset?.serial_number ?? null,
          progress: pct,
          status: st,
          detail_href: `/testing/nsx?asset_id=${assetId}${siteQ}`,
        })
      }
    }

    // Derive check status from asset completion
    let derivedStatus = check.status as string
    if (assets.length > 0) {
      if (completedCount === assets.length) derivedStatus = 'complete'
      else if (completedCount > 0 || inProgressCount > 0) derivedStatus = 'in_progress'
    }

    // Derive month/year from due_date (post-merge — testing_checks no
    // longer stores them as separate columns).
    const dueDate = check.due_date as string | null
    const month = dueDate ? parseInt(dueDate.slice(5, 7), 10) : null
    const year  = dueDate ? parseInt(dueDate.slice(0, 4), 10) : null

    checkRows.push({
      id: check.id as string,
      name: (check.custom_name as string | null) ?? '(unnamed check)',
      check_type: check.kind as 'acb' | 'nsx' | 'general',
      site_name: siteMap[check.site_id as string] ?? '—',
      frequency: check.frequency as string | null,
      month,
      year,
      status: derivedStatus,
      created_at: check.created_at as string,
      total_assets: assets.length,
      completed_assets: completedCount,
      in_progress_assets: inProgressCount,
      assets,
    })
  }

  // KPI counts
  const totalChecks = checkRows.length
  const completeChecks = checkRows.filter(c => c.status === 'complete').length
  const inProgressChecks = checkRows.filter(c => c.status === 'in_progress' || c.status === 'in-progress').length
  const scheduledChecks = checkRows.filter(c => c.status === 'scheduled').length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-eq-ink">Testing Summary</h2>
        <p className="text-sm text-eq-grey mt-0.5">
          Maintenance checks — grouped ACB, NSX and General testing events.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">Total Checks</p>
          <p className="text-3xl font-bold text-eq-ink">{totalChecks}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">Complete</p>
          <p className="text-3xl font-bold text-green-600">{completeChecks}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">In Progress</p>
          <p className="text-3xl font-bold text-eq-deep">{inProgressChecks}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">Scheduled</p>
          <p className="text-3xl font-bold text-amber-600">{scheduledChecks}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Site</label>
            <select name="site_id" defaultValue={siteId} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white">
              <option value="">All Sites</option>
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Type</label>
            <select name="kind" defaultValue={kindFilter} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white">
              <option value="">All Types</option>
              <option value="ACB">ACB</option>
              <option value="NSX">NSX</option>
              <option value="General">General</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Status</label>
            <select name="status" defaultValue={statusFilter} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white">
              <option value="">All Statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="complete">Complete</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 h-9 bg-eq-sky text-white rounded text-sm font-medium hover:bg-eq-deep">
              Apply
            </button>
            <Link href="/testing/summary" className="px-4 h-9 inline-flex items-center bg-gray-100 text-eq-ink rounded text-sm font-medium hover:bg-gray-200">
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {/* Checks table */}
      <CheckSummaryTable checks={checkRows} createdCheckId={createdCheckId || undefined} />
    </div>
  )
}
