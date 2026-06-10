/**
 * GET /api/nsx-report?site_id=xxx
 *
 * Generates and returns a DOCX NSX/MCCB Test Report for the given site.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { generateNsxReport } from '@/lib/reports/nsx-report'
import type { NsxReportInput, NsxReportTest, NsxReportReading } from '@/lib/reports/nsx-report'
import { resolveReportLogos } from '@/lib/reports/logo-variants'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('site_id')
  if (!siteId) {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400 })
  }

  // Complexity override — falls back to tenant default if not provided
  const complexityParam = request.nextUrl.searchParams.get('complexity') as 'summary' | 'standard' | 'detailed' | null
  const validComplexities = ['summary', 'standard', 'detailed'] as const
  const complexityOverride = complexityParam && validComplexities.includes(complexityParam) ? complexityParam : null

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const { data: site } = await supabase
    .from('sites')
    .select('id, name, code')
    .eq('id', siteId)
    .maybeSingle()

  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  // Fetch tenant settings for branding + report config via the cached helper
  // so concurrent report generations for the same tenant share one row read.
  const tenantSettings = await getCachedTenantSettings(tenantId)

  // Fetch tenant row for product-name fallback (logos live on tenant_settings)
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? tenantRow?.name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const complexity = complexityOverride ?? (tenantSettings?.report_complexity as 'summary' | 'standard' | 'detailed' | null) ?? 'standard'

  const { data: testsRaw } = await supabase
    .from('nsx_tests')
    .select('*, assets(name, asset_type, serial_number, maximo_id, location)')
    .eq('site_id', siteId)
    .eq('is_active', true)
    .order('test_date', { ascending: true })

  if (!testsRaw || testsRaw.length === 0) {
    return NextResponse.json({ error: 'No NSX tests found for this site' }, { status: 404 })
  }

  const testIds = testsRaw.map((t) => t.id)
  const { data: allReadings } = await supabase
    .from('nsx_test_readings')
    .select('*')
    .in('nsx_test_id', testIds)
    .order('sort_order')

  const readingsMap: Record<string, NsxReportReading[]> = {}
  for (const r of allReadings ?? []) {
    const key = r.nsx_test_id as string
    if (!readingsMap[key]) readingsMap[key] = []
    readingsMap[key].push({
      label: r.label as string,
      value: r.value as string,
      unit: r.unit as string | null,
      isPass: r.is_pass as boolean | null,
      sortOrder: r.sort_order as number,
    })
  }

  const testerIds = [...new Set(testsRaw.map((t) => t.tested_by).filter((id): id is string => Boolean(id)))]
  const testerMap: Record<string, string> = {}
  if (testerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', testerIds)
    for (const p of profiles ?? []) {
      testerMap[p.id] = p.full_name ?? p.email
    }
  }

  const tests: NsxReportTest[] = testsRaw.map((t) => {
    const asset = t.assets as { name: string; asset_type: string; serial_number: string | null; maximo_id: string | null; location: string | null } | null
    // Sprint 1 schema unification (Refs #101): prefer NEW columns
    // (brand / breaker_type / current_in / trip_unit_model) populated by
    // the 3-step workflow, fall back to LEGACY (cb_make / cb_model /
    // cb_rating / trip_unit) from the bulk-edit form.
    const tRow = t as {
      brand?: string | null
      breaker_type?: string | null
      current_in?: string | null
      trip_unit_model?: string | null
      cb_make?: string | null
      cb_model?: string | null
      cb_rating?: string | null
      trip_unit?: string | null
    }
    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetType: asset?.asset_type ?? '',
      location: asset?.location ?? null,
      assetId: asset?.maximo_id ?? null,
      testDate: t.test_date as string,
      testedBy: t.tested_by ? (testerMap[t.tested_by as string] ?? null) : null,
      testType: t.test_type as string,
      cbMake: tRow.brand ?? (t.cb_make as string | null),
      cbModel: tRow.breaker_type ?? (t.cb_model as string | null),
      cbSerial: t.cb_serial as string | null,
      cbRating: tRow.current_in ?? (t.cb_rating as string | null),
      cbPoles: t.cb_poles as string | null,
      tripUnit: tRow.trip_unit_model ?? (t.trip_unit as string | null),
      overallResult: t.overall_result as string,
      notes: t.notes as string | null,
      readings: readingsMap[t.id as string] ?? [],
    }
  })

  // Resolve tenant + report logo variants — see lib/reports/logo-variants
  const reportLogos = await resolveReportLogos(tenantSettings, tenantRow)

  const input: NsxReportInput = {
    siteName: site.name,
    siteCode: site.code ?? null,
    tenantProductName: productName,
    primaryColour: primaryColour,
    deepColour: tenantSettings?.deep_colour ?? null,
    iceColour: tenantSettings?.ice_colour ?? null,
    inkColour: tenantSettings?.ink_colour ?? null,
    complexity,
    tests,
    // Report settings
    logoImageOnLight: reportLogos.onLight,
    logoImageOnDark:  reportLogos.onDark,
    companyName: tenantSettings?.report_company_name ?? undefined,
    companyAbn: tenantSettings?.report_company_abn ?? undefined,
    companyPhone: tenantSettings?.report_company_phone ?? undefined,
    companyAddress: tenantSettings?.report_company_address ?? undefined,
    showCoverPage: tenantSettings?.report_show_cover_page ?? true,
    showContents: tenantSettings?.report_show_contents ?? true,
    showExecutiveSummary: tenantSettings?.report_show_executive_summary ?? true,
    showSignOff: tenantSettings?.report_show_sign_off ?? true,
    customHeaderText: tenantSettings?.report_header_text ?? undefined,
    customFooterText: tenantSettings?.report_footer_text ?? undefined,
    signOffFields: (tenantSettings?.report_sign_off_fields as string[] | null) ?? undefined,
  }

  try {
    const buffer = await generateNsxReport(input)
    const filename = `NSX Test Report - ${site.name} - ${new Date().toISOString().split('T')[0]}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('NSX report generation failed:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
