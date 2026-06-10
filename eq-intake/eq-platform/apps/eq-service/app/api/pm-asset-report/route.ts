/**
 * GET /api/pm-asset-report?check_id=xxx
 *
 * Generates and returns a professional PM Asset Report (DOCX) for the given
 * maintenance check. Includes cover page, site overview, executive summary,
 * per-asset sections with task checklists, and sign-off page.
 *
 * Requires supervisor+ role (canWrite permission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { generatePMAssetReport } from '@/lib/reports/pm-asset-report'
import type {
  PmAssetReportInput,
  PmAssetSection,
  PmAssetTask,
  AcbTestSummary,
  NsxTestSummary,
  RcdTestSummary,
} from '@/lib/reports/pm-asset-report'
import {
  resolveReportLogos,
  fetchSitePhoto,
} from '@/lib/reports/logo-variants'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'
import type { AcbTestDetail, BreakerTestReading } from '@/lib/reports/pm-asset-report'
import { resolveBreakerIdentity, formatMakeModel, type BreakerIdentityRow } from '@/lib/reports/breaker-identity'
import { captureSlowReportRun } from '@/lib/observability/report-duration-canary'

// DOCX generation is CPU-bound and runs through ~12 sequential Supabase
// queries before the docx-tree synthesis starts. At Jemena-scale (multi-site
// reports with 50+ linked tests) the round-trip approaches 20s. Set the
// hint to 60s so Netlify doesn't cut us off at the default. Actual cap is
// determined by the Netlify plan (Pro = 26s synchronous, background = 15m).
// Long-term fix is to move to a background-function pattern — design parked
// in docs/architecture/report-delivery.md. The canary at the bottom of
// this handler surfaces when that refactor becomes load-bearing.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const checkId = request.nextUrl.searchParams.get('check_id')
  if (!checkId) {
    return NextResponse.json({ error: 'check_id is required' }, { status: 400 })
  }

  // Complexity override — falls back to tenant default if not provided
  const complexityParam = request.nextUrl.searchParams.get('complexity') as 'summary' | 'standard' | 'detailed' | null
  const validComplexities = ['summary', 'standard', 'detailed'] as const
  const complexityOverride = complexityParam && validComplexities.includes(complexityParam) ? complexityParam : null

  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Role check — supervisor+ to generate reports
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role, tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership || !canWrite(membership.role as Role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const tenantId = membership.tenant_id

  // Fetch maintenance check with site + maintenance plan
  const { data: check } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name, code), sites(name, address)')
    .eq('id', checkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!check) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  // Fetch site details for customer info + logo variants
  const { data: site } = await supabase
    .from('sites')
    .select('*, customers(name, logo_url, logo_url_on_dark)')
    .eq('id', check.site_id)
    .maybeSingle()

  // Fetch check_assets with related asset info
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location, job_plans(name, code))')
    .eq('check_id', checkId)
    .order('created_at')

  if (!checkAssets) {
    return NextResponse.json({ error: 'Failed to fetch check assets' }, { status: 500 })
  }

  // Fetch ALL check items for this check in one query
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', checkId)
    .order('sort_order')

  if (!allItems) {
    return NextResponse.json({ error: 'Failed to fetch check items' }, { status: 500 })
  }

  // Group items by check_asset_id
  const itemsByCheckAsset: Record<string, typeof allItems> = {}
  for (const item of allItems) {
    const caId = item.check_asset_id ?? '_unlinked'
    if (!itemsByCheckAsset[caId]) itemsByCheckAsset[caId] = []
    itemsByCheckAsset[caId].push(item)
  }

  // Fetch tenant settings for branding + report config via the cached helper
  // so concurrent report generations for the same tenant share one row read.
  const tenantSettings = await getCachedTenantSettings(tenantId)

  // Fetch tenant row for product-name fallback
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? tenantRow?.name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const complexity = complexityOverride ?? (tenantSettings?.report_complexity as 'summary' | 'standard' | 'detailed' | null) ?? 'standard'

  // Resolve tenant logo. Customer logo dropped from the cover 2026-04-28
  // (see report-input section below) — the resolveCustomerLogos call is
  // gone too so we don't waste a fetch on something that won't render.
  const reportLogos = await resolveReportLogos(tenantSettings, tenantRow)
  const sitePhoto = check.site_id ? await fetchSitePhoto(supabase, check.site_id, tenantId) : undefined

  // Resolve user names (assigned_to + created_by + per-item completed_by).
  //
  // maintenance_checks has no completed_by column, only assigned_to,
  // created_by, and completed_at. The historical code read check.completed_by
  // (which silently returned undefined), so supervisorName and reviewerName
  // on the cover have always rendered '—' and null. We now use created_by
  // (the user who scheduled the check) for the supervisor / reviewer slots —
  // that's a real, meaningful field and matches the SKS workflow where a
  // supervisor schedules and a tech executes.
  const userIds = new Set<string>()
  if (check.assigned_to) userIds.add(check.assigned_to)
  if ((check as { created_by?: string | null }).created_by) {
    userIds.add((check as { created_by: string }).created_by)
  }
  for (const item of allItems) {
    if (item.completed_by) userIds.add(item.completed_by)
  }

  const userMap: Record<string, string> = {}
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', Array.from(userIds))
    for (const p of profiles ?? []) {
      userMap[p.id] = p.full_name ?? p.email
    }
  }

  // Count outstanding items
  const outstandingAssets = checkAssets.filter(ca => ca.status !== 'completed' && ca.status !== 'na').length
  // Only meaningful for Maximo-style imports where SOME assets carry a WO
  // number. If none do (manual-create check), the metric is "all assets are
  // outstanding" which is useless noise — pass null so the report hides the
  // row. If ALL assets have a WO# (typical Equinix Delta import), the count
  // is genuinely 0 and we surface that as compliance evidence.
  const woCount = checkAssets.filter(ca => !!ca.work_order_number).length
  const outstandingWOs = woCount === 0 ? null : checkAssets.length - woCount

  // Phase 5: Linked test records — fetch ACB / NSX / RCD tests that point
  // at this maintenance_check, summarise to one row per asset, and pass
  // through to the report builder. Renders a Test Records section in the
  // PDF when any kind has rows; silently absent for plain PPM checks.
  // PR Q (2026-04-28): pull deep ACB/NSX columns + readings so the report
  // can render per-test detail cards alongside the existing summary tables.
  // Bulk-fetch readings via .in() so cost stays at 2 round-trips per type
  // regardless of test count.
  const [acbLinkedRes, nsxLinkedRes, rcdLinkedRes] = await Promise.all([
    supabase
      .from('acb_tests')
      // Sprint 1 schema unification (Refs #101): pull BOTH legacy and new
      // breaker-identification columns so the report renders regardless of
      // which entry path created the row. Migration 0094 backfills new
      // from legacy where missing; writes are dual-write so future rows
      // populate both. Read prefers NEW with LEGACY fallback below.
      .select(
        'id, test_date, test_type, cb_make, cb_model, cb_serial, cb_rating, cb_poles, trip_unit, brand, breaker_type, current_in, trip_unit_model, performance_level, fixed_withdrawable, step1_status, step2_status, step3_status, overall_result, assets(name)',
      )
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('nsx_tests')
      // Refs #101: same dual-column read as ACB above.
      .select(
        'id, test_date, test_type, cb_make, cb_model, cb_serial, cb_rating, cb_poles, trip_unit, brand, breaker_type, current_in, trip_unit_model, fixed_withdrawable, step1_status, step2_status, step3_status, overall_result, assets(name)',
      )
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('rcd_tests')
      .select('id, test_date, status, assets(name, jemena_asset_id)')
      .eq('check_id', checkId)
      .eq('is_active', true)
      .order('test_date', { ascending: false }),
  ])

  // Bulk-fetch readings for each test type. One round-trip per type.
  const acbIds = (acbLinkedRes.data ?? []).map((t) => t.id)
  const nsxIds = (nsxLinkedRes.data ?? []).map((t) => t.id)
  type ReadingRow = { acb_test_id?: string; nsx_test_id?: string; label: string; value: string; unit: string | null; is_pass: boolean | null; sort_order: number }
  const acbReadingsByTest = new Map<string, BreakerTestReading[]>()
  const nsxReadingsByTest = new Map<string, BreakerTestReading[]>()
  if (acbIds.length > 0) {
    const { data: rows } = await supabase
      .from('acb_test_readings')
      .select('acb_test_id, label, value, unit, is_pass, sort_order')
      .in('acb_test_id', acbIds)
      .order('sort_order')
    for (const r of (rows ?? []) as ReadingRow[]) {
      const arr = acbReadingsByTest.get(r.acb_test_id!) ?? []
      arr.push({ label: r.label, value: r.value, unit: r.unit, isPass: r.is_pass })
      acbReadingsByTest.set(r.acb_test_id!, arr)
    }
  }
  if (nsxIds.length > 0) {
    const { data: rows } = await supabase
      .from('nsx_test_readings')
      .select('nsx_test_id, label, value, unit, is_pass, sort_order')
      .in('nsx_test_id', nsxIds)
      .order('sort_order')
    for (const r of (rows ?? []) as ReadingRow[]) {
      const arr = nsxReadingsByTest.get(r.nsx_test_id!) ?? []
      arr.push({ label: r.label, value: r.value, unit: r.unit, isPass: r.is_pass })
      nsxReadingsByTest.set(r.nsx_test_id!, arr)
    }
  }

  // Sprint 1 schema unification (Refs #101): see lib/reports/breaker-identity.ts
  // for the canonical helper. NEW workflow columns preferred over LEGACY;
  // the helper is the single place to update when legacy columns get dropped.
  type BreakerCols = BreakerIdentityRow & { id: string }
  function buildAcbDetail(t: typeof acbLinkedRes.data extends Array<infer U> | null ? U : never): AcbTestDetail {
    const r = t as unknown as BreakerCols
    return {
      ...resolveBreakerIdentity(r, { includePerformanceLevel: true }),
      readings: acbReadingsByTest.get(r.id) ?? [],
    }
  }
  function buildNsxDetail(t: typeof nsxLinkedRes.data extends Array<infer U> | null ? U : never): AcbTestDetail {
    const r = t as unknown as BreakerCols
    return {
      ...resolveBreakerIdentity(r, { includePerformanceLevel: false }),
      readings: nsxReadingsByTest.get(r.id) ?? [],
    }
  }

  function unwrap<T>(v: T | T[] | null): T | null {
    if (!v) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }
  function stepCount(t: { step1_status: string | null; step2_status: string | null; step3_status: string | null }): number {
    return (
      (t.step1_status === 'complete' ? 1 : 0) +
      (t.step2_status === 'complete' ? 1 : 0) +
      (t.step3_status === 'complete' ? 1 : 0)
    )
  }

  const acbSummaries: AcbTestSummary[] = (acbLinkedRes.data ?? []).map((t) => {
    const asset = unwrap(t.assets as { name: string } | { name: string }[] | null)
    return {
      assetName: asset?.name ?? '—',
      cbMakeModel: formatMakeModel(t as unknown as BreakerIdentityRow),
      testType: t.test_type ?? '—',
      testDate: t.test_date,
      stepsDone: stepCount(t),
      stepsTotal: 3,
      overallResult: (t.overall_result as 'Pass' | 'Fail' | 'Defect' | 'Pending') ?? 'Pending',
      detail: buildAcbDetail(t),
    }
  })

  const nsxSummaries: NsxTestSummary[] = (nsxLinkedRes.data ?? []).map((t) => {
    const asset = unwrap(t.assets as { name: string } | { name: string }[] | null)
    return {
      assetName: asset?.name ?? '—',
      cbMakeModel: formatMakeModel(t as unknown as BreakerIdentityRow),
      testType: t.test_type ?? '—',
      testDate: t.test_date,
      stepsDone: stepCount(t),
      stepsTotal: 3,
      overallResult: (t.overall_result as 'Pass' | 'Fail' | 'Defect' | 'Pending') ?? 'Pending',
      detail: buildNsxDetail(t),
    }
  })

  // RCD per-circuit data — bulk fetch ALL circuits for the linked tests
  // and bucket by parent rcd_test_id. Phase 5 follow-up (PR O — 2026-04-28):
  // the report now includes a deep "RCD Circuit Timing" section per board
  // when this data is present, giving customers per-circuit compliance
  // evidence (AS/NZS 3760).
  const rcdRows = rcdLinkedRes.data ?? []
  const rcdIds = rcdRows.map((r) => r.id)
  type CircuitRow = {
    rcd_test_id: string
    section_label: string | null
    circuit_no: string
    normal_trip_current_ma: number
    jemena_circuit_asset_id: string | null
    x1_no_trip_0_ms: string | null
    x1_no_trip_180_ms: string | null
    x1_trip_0_ms: string | null
    x1_trip_180_ms: string | null
    x5_fast_0_ms: string | null
    x5_fast_180_ms: string | null
    trip_test_button_ok: boolean
    is_critical_load: boolean
    action_taken: string | null
    sort_order: number
  }
  const circuitsByTest = new Map<string, CircuitRow[]>()
  if (rcdIds.length > 0) {
    const { data: circuitRows } = await supabase
      .from('rcd_test_circuits')
      .select(
        'rcd_test_id, section_label, circuit_no, normal_trip_current_ma, jemena_circuit_asset_id, x1_no_trip_0_ms, x1_no_trip_180_ms, x1_trip_0_ms, x1_trip_180_ms, x5_fast_0_ms, x5_fast_180_ms, trip_test_button_ok, is_critical_load, action_taken, sort_order',
      )
      .in('rcd_test_id', rcdIds)
      .order('sort_order')
    for (const c of (circuitRows ?? []) as CircuitRow[]) {
      const arr = circuitsByTest.get(c.rcd_test_id) ?? []
      arr.push(c)
      circuitsByTest.set(c.rcd_test_id, arr)
    }
  }

  const rcdSummaries: RcdTestSummary[] = rcdRows.map((t) => {
    const asset = unwrap(t.assets as { name: string; jemena_asset_id: string | null } | { name: string; jemena_asset_id: string | null }[] | null)
    const ckts = circuitsByTest.get(t.id) ?? []
    return {
      assetName: asset?.name ?? '—',
      jemenaAssetId: asset?.jemena_asset_id ?? null,
      testDate: t.test_date,
      circuitCount: ckts.length,
      status: (t.status as 'draft' | 'complete' | 'archived') ?? 'draft',
      // Map column names → camelCase for the report builder.
      circuits: ckts.length > 0
        ? ckts.map((c) => ({
            sectionLabel: c.section_label,
            circuitNo: c.circuit_no,
            normalTripCurrentMa: c.normal_trip_current_ma,
            jemenaCircuitAssetId: c.jemena_circuit_asset_id,
            x1NoTrip0Ms: c.x1_no_trip_0_ms,
            x1NoTrip180Ms: c.x1_no_trip_180_ms,
            x1Trip0Ms: c.x1_trip_0_ms,
            x1Trip180Ms: c.x1_trip_180_ms,
            x5Fast0Ms: c.x5_fast_0_ms,
            x5Fast180Ms: c.x5_fast_180_ms,
            tripTestButtonOk: c.trip_test_button_ok,
            isCriticalLoad: c.is_critical_load,
            actionTaken: c.action_taken,
          }))
        : undefined,
    }
  })

  // Build per-asset sections
  const assetSections: PmAssetSection[] = checkAssets.map(ca => {
    const asset = ca.assets as { name: string; maximo_id: string | null; location: string | null; job_plans: { name: string; code: string | null } | null } | null
    const items = itemsByCheckAsset[ca.id] ?? []

    // Detect defects: items with result = 'fail'
    const failedItems = items.filter(i => i.result === 'fail' || i.result === 'no')
    const defectsFound = failedItems.length > 0
      ? failedItems.map(i => `${i.description}${i.notes ? ': ' + i.notes : ''}`).join('; ')
      : undefined

    const tasks: PmAssetTask[] = items.map((item, idx) => ({
      order: idx + 1,
      description: item.description,
      result: item.result as PmAssetTask['result'],
      notes: item.notes ?? undefined,
    }))

    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetId: asset?.maximo_id ?? ca.asset_id,
      site: site?.name ?? (check.sites as { name: string } | null)?.name ?? 'Unknown',
      location: asset?.location ?? '—',
      jobPlanName: asset?.job_plans?.name ?? (check.job_plans as { name: string } | null)?.name ?? '—',
      workOrderNumber: ca.work_order_number ?? null,

      // Maximo WO metadata persisted by PR #178 (delta-row-mapping.ts). These
      // fields render in the per-asset info grid + a conditional failure-chain
      // block. Null on manual-create checks; populated on Delta-imported ones.
      priority: ca.priority ?? null,
      workType: ca.work_type ?? null,
      crewId: ca.crew_id ?? null,
      targetStart: ca.target_start ?? null,
      targetFinish: ca.target_finish ?? null,
      classification: ca.classification ?? null,
      irScanResult: ca.ir_scan_result ?? null,
      failureCode: ca.failure_code ?? null,
      problem: ca.problem ?? null,
      cause: ca.cause ?? null,
      remedy: ca.remedy ?? null,

      tasks,
      defectsFound,
      recommendedAction: failedItems.length > 0 ? 'Follow-up rectification required for failed items.' : undefined,
      technicianName: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : 'Unassigned',
      completedDate: ca.completed_at,
      notes: ca.notes ?? undefined,
    }
  })

  // Build the full report input
  const siteName = site?.name ?? (check.sites as { name: string } | null)?.name ?? 'Unknown Site'
  const customerName = (site?.customers as { name: string } | null)?.name ?? 'Unknown Customer'
  const jobPlanCode = (check.job_plans as { code: string | null } | null)?.code ?? ''
  const jobPlanName = (check.job_plans as { name: string } | null)?.name ?? ''
  const frequency = check.frequency?.replace('_', ' ') ?? ''

  const reportInput: PmAssetReportInput = {
    complexity,
    reportTitle: check.custom_name ?? `${siteName} - ${frequency} - ${jobPlanName}`,
    reportGeneratedDate: new Date().toISOString(),
    reportingPeriod: fmtPeriod(check.due_date ?? check.created_at),

    siteName,
    siteCode: jobPlanCode || siteName,
    siteAddress: site?.address ?? '—',
    customerName,
    // supervisorName is the user who scheduled the check (created_by). For
    // SKS workflow the supervisor schedules and a tech executes — this lines
    // up with reality and replaces the historical '—' dead-read.
    supervisorName: (check as { created_by?: string | null }).created_by
      ? (userMap[(check as { created_by: string }).created_by] ?? '—')
      : '—',
    contactEmail: '—',
    contactPhone: '—',

    startDate: check.started_at ?? check.created_at,
    dueDate: check.due_date ?? '—',
    completedDate: check.completed_at,
    outstandingAssets,
    outstandingWorkOrders: outstandingWOs,

    technicianName: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : 'Unassigned',
    // reviewerName uses created_by (the supervisor who scheduled). Same as
    // supervisorName above — the sign-off page can render the same name for
    // both fields when supervisor and reviewer are the same person.
    reviewerName: (check as { created_by?: string | null }).created_by
      ? (userMap[(check as { created_by: string }).created_by] ?? null)
      : null,

    tenantProductName: productName,
    primaryColour,

    // Tenant / report logo variants (light + dark surface)
    logoImageOnLight: reportLogos.onLight,
    logoImageOnDark:  reportLogos.onDark,

    // Customer logo variants (cover page "Prepared for" lockup)
    // Customer logo dropped from cover 2026-04-28 (Royce review issue 9):
    // the cover already names the customer in headline type; rendering a
    // small customer logo alongside the tenant logo created a "two-logo
    // mosaic" that looked municipal-tender. Tenant logo only on the cover.
    customerLogoOnLight: undefined,
    customerLogoOnDark:  undefined,

    // Site photo (cover page hero, below customer lockup)
    sitePhoto,

    // Company details from report settings
    companyName: tenantSettings?.report_company_name ?? undefined,
    companyAddress: tenantSettings?.report_company_address ?? undefined,
    companyAbn: tenantSettings?.report_company_abn ?? undefined,
    companyPhone: tenantSettings?.report_company_phone ?? undefined,

    assets: assetSections,
    linkedTests:
      acbSummaries.length > 0 || nsxSummaries.length > 0 || rcdSummaries.length > 0
        ? {
            acb: acbSummaries.length > 0 ? acbSummaries : undefined,
            nsx: nsxSummaries.length > 0 ? nsxSummaries : undefined,
            rcd: rcdSummaries.length > 0 ? rcdSummaries : undefined,
          }
        : undefined,
    overallNotes: check.notes ?? undefined,

    // Report template config
    // showSiteOverview removed 26-Apr-2026 (audit item 7) — always rendered.
    showCoverPage: tenantSettings?.report_show_cover_page ?? true,
    showContents: tenantSettings?.report_show_contents ?? true,
    showExecutiveSummary: tenantSettings?.report_show_executive_summary ?? true,
    showSignOff: tenantSettings?.report_show_sign_off ?? true,
    customHeaderText: tenantSettings?.report_header_text ?? undefined,
    customFooterText: tenantSettings?.report_footer_text ?? undefined,
    signOffFields: (tenantSettings?.report_sign_off_fields as string[] | null) ?? undefined,
  }

  try {
    const buffer = await generatePMAssetReport(reportInput)
    const filename = `PM Asset Report - ${siteName} - ${new Date().toISOString().split('T')[0]}.docx`

    captureSlowReportRun({
      route: 'GET /api/pm-asset-report',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 200,
      scale: {
        assets: checkAssets.length,
        items: allItems.length,
        acbTests: acbLinkedRes.data?.length ?? 0,
        nsxTests: nsxLinkedRes.data?.length ?? 0,
        rcdTests: rcdLinkedRes.data?.length ?? 0,
      },
    })

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('PM Asset Report generation failed:', err)
    captureSlowReportRun({
      route: 'GET /api/pm-asset-report',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 500,
      scale: { errored: 1 },
    })
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}

// Helper: format a date string into "Month YYYY" for the reporting period
function fmtPeriod(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']
    return `${months[d.getMonth()]} ${d.getFullYear()}`
  } catch {
    return dateStr
  }
}
