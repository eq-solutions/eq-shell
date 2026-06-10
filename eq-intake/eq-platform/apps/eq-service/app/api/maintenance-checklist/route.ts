/**
 * GET /api/maintenance-checklist?check_id=xxx
 *
 * Generates and returns a printable Maintenance Checklist (DOCX) for the given
 * maintenance check. Designed for site teams to print, complete by hand, and
 * then enter results into the app.
 *
 * Requires supervisor+ role (canWrite permission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { generateMaintenanceChecklist } from '@/lib/reports/maintenance-checklist'
import type { MaintenanceChecklistInput, ChecklistAsset } from '@/lib/reports/maintenance-checklist'
import { formatMakeModel, type BreakerIdentityRow } from '@/lib/reports/breaker-identity'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'
import { fetchLogoImage } from '@/lib/reports/report-branding'
import { TENANT_LOGO_LIGHT, TENANT_LOGO_ON_DARK, CUSTOMER_LOGO_LIGHT } from '@/lib/reports/sizing'
import { captureSlowReportRun } from '@/lib/observability/report-duration-canary'

// Field run-sheet DOCX is the lightest of the three report routes but still
// runs through a check_assets fetch + items fan-out + logo decode +
// docx-tree synthesis. Set the runtime hint so we don't get cut off at
// the default. Actual cap is the Netlify plan limit.
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Map the public-facing format token (summary/standard/detailed) to the legacy
 * generator format (simple/detailed). 'standard' is a new middle ground —
 * runs the detailed layout but suppresses the most granular task notes.
 *
 * Older callers using 'simple' continue to work.
 */
function normaliseFormat(raw: string | null): 'simple' | 'standard' | 'detailed' {
  const v = (raw ?? 'standard').toLowerCase()
  if (v === 'simple' || v === 'summary') return 'simple'
  if (v === 'detailed') return 'detailed'
  return 'standard'
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const checkId = request.nextUrl.searchParams.get('check_id')
  const format = normaliseFormat(request.nextUrl.searchParams.get('format'))
  if (!checkId) {
    return NextResponse.json({ error: 'check_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Role check — supervisor+ to generate checklists
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
    .select('*, job_plans(name, code), sites(name)')
    .eq('id', checkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!check) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  // Fetch check_assets with related asset info
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location)')
    .eq('check_id', checkId)
    .order('created_at')

  if (!checkAssets) {
    return NextResponse.json({ error: 'Failed to fetch check assets' }, { status: 500 })
  }

  // Fetch ALL check items for this check in one query (lift Supabase 1000-row default)
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', checkId)
    .order('sort_order')
    .limit(10000)

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

  // Fetch tenant settings for branding — primary colour drives the brand
  // strip on the field run-sheet; logos render in the strip when available.
  // Without this fetch the strip fell back to EQ Sky + showed text-only
  // company name instead of the SKS (or other tenant) logo.
  const tenantSettings = await getCachedTenantSettings(tenantId)

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const companyName = tenantSettings?.report_company_name ?? productName
  const companyAbn = tenantSettings?.report_company_abn ?? null
  const primaryColour = (tenantSettings?.primary_colour ?? '#3DA8D8').replace('#', '')

  // Customer logo (if site has a customer)
  let customerLogoUrl: string | null = null
  const siteRow = check.sites as { name?: string; customer_id?: string | null } | null
  if (siteRow?.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('logo_url')
      .eq('id', siteRow.customer_id)
      .maybeSingle()
    customerLogoUrl = customer?.logo_url ?? null
  }

  // Resolve which tenant-light logo to use. Field run-sheet brand strip is
  // a dark surface (tenant brand colour fill) so prefer the on-dark variant;
  // fall back to the light one if no dark variant uploaded.
  const tenantLogoLightUrl = tenantSettings?.report_logo_url ?? tenantSettings?.logo_url ?? null
  const tenantLogoDarkUrl = tenantSettings?.report_logo_url_on_dark ?? tenantSettings?.logo_url_on_dark ?? null

  const [tenantLogoImage, customerLogoImage] = await Promise.all([
    fetchLogoImage(tenantLogoDarkUrl ?? tenantLogoLightUrl, TENANT_LOGO_ON_DARK),
    fetchLogoImage(customerLogoUrl, CUSTOMER_LOGO_LIGHT),
  ])

  // Resolve user names (assigned_to)
  const userIds = new Set<string>()
  if (check.assigned_to) userIds.add(check.assigned_to)

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

  // Build per-asset sections from check_assets (kind=maintenance flow).
  let checklistAssets: ChecklistAsset[] = checkAssets.map(ca => {
    const asset = ca.assets as { name: string; maximo_id: string | null; location: string | null } | null
    const items = itemsByCheckAsset[ca.id] ?? []

    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetId: asset?.maximo_id ?? ca.asset_id,
      location: asset?.location ?? '—',
      workOrderNumber: ca.work_order_number ?? null,
      tasks: items.map((item, idx) => ({
        order: idx + 1,
        description: item.description,
      })),
      notes: ca.notes ?? null,
    }
  })

  // Phase A (2026-04-28): when this is a test-bench check (kind in
  // acb/nsx/rcd), synthesize ChecklistAsset entries from the linked tests
  // so the run-sheet has something useful to print. Without this the tech
  // got a blank page (cover + sign-off only) — confirmed by Royce printing
  // the SY6 NSX run-sheet 2026-04-28.
  //
  // 2026-05-21: kind is the only discriminator. Previously we also required
  // checkAssets.length === 0, but that silently dropped test detail on
  // hybrid checks where the asset under test also exists as a check_asset
  // (legitimate — e.g. an ACB workflow attached to a PPM check_asset row).
  // For test-kind checks, the synthesized rows are always the right answer.
  //
  // Each linked test → one ChecklistAsset with a compact 5-row task list
  // (breaker details, visual, electrical, overall, notes) for ACB/NSX,
  // or one row per circuit for RCD. Tech writes values into the comment
  // cells and types them into the app afterwards.
  const kind = (check as { kind?: string | null }).kind ?? 'maintenance'
  const isTestKind = kind === 'acb' || kind === 'nsx' || kind === 'rcd'

  if (isTestKind) {
    if (kind === 'acb' || kind === 'nsx') {
      const table = kind === 'acb' ? 'acb_tests' : 'nsx_tests'
      // Sprint 1 schema unification (Refs #101): pull NEW columns alongside
      // LEGACY so the run-sheet renders breaker identification regardless
      // of which form-path created the row. cb_serial is shared between
      // both surfaces — single read.
      const { data: tests } = await supabase
        .from(table)
        .select(
          'id, asset_id, cb_make, cb_model, cb_serial, brand, breaker_type, assets(name, maximo_id, location)',
        )
        .eq('check_id', checkId)
        .eq('is_active', true)
        .order('created_at')

      checklistAssets = (tests ?? []).map((t) => {
        const a = t.assets as { name: string; maximo_id: string | null; location: string | null } | { name: string; maximo_id: string | null; location: string | null }[] | null
        const asset = Array.isArray(a) ? a[0] ?? null : a
        // Refs #101: helper centralises new ?? legacy fallback.
        const makeModel = formatMakeModel(t as unknown as BreakerIdentityRow)
        const serial = (t.cb_serial as string | null) ?? ''
        const breakerLine =
          [makeModel === '—' ? null : makeModel, serial].filter(Boolean).join(' / ') || '_______________________________________________'
        return {
          assetName: asset?.name ?? 'Breaker',
          assetId: asset?.maximo_id ?? '—',
          location: asset?.location ?? '—',
          workOrderNumber: null,
          tasks: [
            { order: 1, description: `Breaker (Brand / Model / Serial): ${breakerLine}` },
            { order: 2, description: 'Visual & Functional checks (record anomalies in comment)' },
            { order: 3, description: 'Electrical readings — Contact resistance R/W/B (µΩ), IR closed/open (MΩ), temperature (°C)' },
            { order: 4, description: 'Overall result: Pass / Fail / Defect (circle one)' },
            { order: 5, description: 'Notes / follow-up' },
          ],
          notes: null,
        }
      })
    } else if (kind === 'rcd') {
      // RCD: per-board card with one row per circuit. Pull the rcd_tests +
      // their circuits and build a card per board.
      const { data: rcdTests } = await supabase
        .from('rcd_tests')
        .select('id, asset_id, assets(name, jemena_asset_id, location)')
        .eq('check_id', checkId)
        .eq('is_active', true)
        .order('created_at')

      const testIds = (rcdTests ?? []).map((t) => t.id)
      const circuitsByTest = new Map<string, Array<{ section_label: string | null; circuit_no: string; normal_trip_current_ma: number | null }>>()
      if (testIds.length > 0) {
        const { data: allCircuits } = await supabase
          .from('rcd_test_circuits')
          .select('rcd_test_id, section_label, circuit_no, normal_trip_current_ma, sort_order')
          .in('rcd_test_id', testIds)
          .order('sort_order')
        for (const c of allCircuits ?? []) {
          const arr = circuitsByTest.get(c.rcd_test_id) ?? []
          arr.push({
            section_label: c.section_label as string | null,
            circuit_no: c.circuit_no as string,
            normal_trip_current_ma: c.normal_trip_current_ma as number | null,
          })
          circuitsByTest.set(c.rcd_test_id, arr)
        }
      }

      checklistAssets = (rcdTests ?? []).map((t) => {
        const a = t.assets as { name: string; jemena_asset_id: string | null; location: string | null } | { name: string; jemena_asset_id: string | null; location: string | null }[] | null
        const asset = Array.isArray(a) ? a[0] ?? null : a
        const circuits = circuitsByTest.get(t.id) ?? []
        const tasks = circuits.length > 0
          ? circuits.map((c, idx) => {
              const section = c.section_label ? `${c.section_label} · ` : ''
              const rating = c.normal_trip_current_ma ? `${c.normal_trip_current_ma}mA` : ''
              return {
                order: idx + 1,
                description: `${section}Circuit ${c.circuit_no} (${rating}) — X1 No-Trip 0°/180°: ___ / ___ ms · X1 Trip 0°/180°: ___ / ___ ms · X5 0°/180°: ___ / ___ ms · Btn ☐`,
              }
            })
          : [
              { order: 1, description: 'No circuits enumerated yet — record per-circuit timing values below' },
            ]
        return {
          assetName: asset?.name ?? 'Board',
          assetId: asset?.jemena_asset_id ?? '—',
          location: asset?.location ?? '—',
          workOrderNumber: null,
          tasks,
          notes: null,
        }
      })
    }
  }

  // Format dates as Australian long-form ("26 April 2026") to match the
  // other report generators. Without an explicit locale, Node defaults to
  // the server's locale (Netlify Linux = en-US "5/1/2026") which both
  // looks American and ambiguous to AU readers (5 Jan vs 1 May).
  const dateFmt: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long', year: 'numeric' }
  const dueDateStr = check.due_date ? new Date(check.due_date).toLocaleDateString('en-AU', dateFmt) : '—'
  const printedDateStr = new Date().toLocaleDateString('en-AU', dateFmt)
  // Capitalise frequency for display ("quarterly" -> "Quarterly").
  // DB enum is lowercase; the UI capitalises it everywhere except here.
  const rawFreq = check.frequency?.replace(/_/g, ' ') ?? '—'
  const frequency = rawFreq.charAt(0).toUpperCase() + rawFreq.slice(1)

  // Maximo WO# at check level — derive a sensible summary from the per-asset
  // WO numbers. Single WO across all assets → show it; multiple distinct →
  // "Multiple (see assets)"; none → null (header row stays hidden).
  // Previously hardcoded to null with comment "Not stored at check level
  // currently" — true at the DB level but not useful at the header.
  const distinctWoNumbers = Array.from(
    new Set(checkAssets.map(ca => ca.work_order_number).filter((wo): wo is string => !!wo)),
  )
  const maximoWoSummary =
    distinctWoNumbers.length === 0 ? null
    : distinctWoNumbers.length === 1 ? distinctWoNumbers[0]
    : `Multiple (${distinctWoNumbers.length} — see asset sections)`

  // Build the checklist input
  const checklistInput: MaintenanceChecklistInput = {
    companyName,
    companyAbn,
    checkName: check.custom_name ?? `${(check.job_plans as { name: string } | null)?.name ?? 'Check'} - ${frequency}`,
    siteName: (check.sites as { name: string } | null)?.name ?? 'Unknown Site',
    dueDate: dueDateStr,
    frequency,
    assignedTo: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : null,
    maximoWONumber: maximoWoSummary,
    maximoPMNumber: (check.job_plans as { code: string | null } | null)?.code ?? null,
    printedDate: printedDateStr,
    assets: checklistAssets,
    tenantProductName: productName,
    primaryColour,
    deepColour: tenantSettings?.deep_colour ?? null,
    iceColour: tenantSettings?.ice_colour ?? null,
    inkColour: tenantSettings?.ink_colour ?? null,
    tenantLogoImage,
    customerLogoImage,
    format,
  }

  try {
    const buffer = await generateMaintenanceChecklist(checklistInput)
    const siteName = (check.sites as { name: string } | null)?.name ?? 'Unknown Site'
    const formatLabel = format === 'simple' ? 'summary' : format
    const filename = `Run-Sheet - ${siteName} - ${formatLabel} - ${new Date().toISOString().split('T')[0]}.docx`

    captureSlowReportRun({
      route: 'GET /api/maintenance-checklist',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 200,
      scale: {
        format,
        assets: checklistInput.assets.length,
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
    console.error('Maintenance Checklist generation failed:', err)
    captureSlowReportRun({
      route: 'GET /api/maintenance-checklist',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 500,
      scale: { format, errored: 1 },
    })
    return NextResponse.json({ error: 'Checklist generation failed' }, { status: 500 })
  }
}
