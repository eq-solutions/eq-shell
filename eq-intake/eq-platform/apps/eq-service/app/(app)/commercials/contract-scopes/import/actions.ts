'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'
import {
  parseCommercialSheet,
  type ParsedScope,
  type ParsedSheet,
} from '@/lib/parsers/commercial-sheet'

// ── Types returned to the UI ────────────────────────────────────────────

export interface CustomerOption {
  id: string
  name: string
  code: string | null
  contract_template: string | null
}

export interface SiteOption {
  id: string
  customer_id: string
  code: string | null
  name: string
}

export interface ExistingCounts {
  scopes: number
  calendar: number
  gaps: number
}

export interface PreviewResult {
  ok: true
  filename: string
  parsed: ParsedSheet
  customers: CustomerOption[]
  sites: SiteOption[]
  matchedSiteId: string | null
  /** Sum of year_totals per year across all parsed rows (scopes + additional). */
  parsedYearTotals: Record<string, number>
  /** Years that appear as keys in any row's year_totals — used to validate the picked FY. */
  workbookYears: string[]
}

export interface AssetCountsResult {
  ok: true
  /** jp_code -> count of active assets at this site mapped to that JP. */
  countsByJp: Record<string, number>
}

export interface CommitResult {
  ok: true
  inserted: { scopes: number; additional_items: number }
  wiped: ExistingCounts
  source_import_id: string
}

export type ActionFailure = { ok: false; error: string; warnings?: string[] }

// ── Helpers ─────────────────────────────────────────────────────────────

async function readFileFromForm(formData: FormData): Promise<{ buffer: Buffer; filename: string } | ActionFailure> {
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'No file uploaded.' }
  if (!file.name.toLowerCase().endsWith('.xlsx')) return { ok: false, error: 'File must be a .xlsx workbook.' }
  const arrayBuffer = await file.arrayBuffer()
  return { buffer: Buffer.from(arrayBuffer), filename: file.name }
}

/** Aggregate per-year totals across both scope arrays. */
function aggregateYearTotals(parsed: ParsedSheet): { totalsPerYear: Record<string, number>; workbookYears: string[] } {
  const totals: Record<string, number> = {}
  for (const s of [...parsed.scopes, ...parsed.additional_items]) {
    for (const [year, amount] of Object.entries(s.year_totals)) {
      totals[year] = (totals[year] ?? 0) + (amount ?? 0)
    }
  }
  const years = Object.keys(totals).sort()
  return { totalsPerYear: totals, workbookYears: years }
}

// ── Preview ─────────────────────────────────────────────────────────────

export async function previewCommercialSheetAction(
  formData: FormData,
): Promise<PreviewResult | ActionFailure> {
  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  const fileResult = await readFileFromForm(formData)
  if ('ok' in fileResult && fileResult.ok === false) return fileResult
  const { buffer, filename } = fileResult as { buffer: Buffer; filename: string }

  const parsed = await parseCommercialSheet(buffer, filename)
  if (parsed.errors.length > 0) {
    return { ok: false, error: parsed.errors.join(' · ') }
  }

  const [{ data: customers }, { data: sites }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, code, contract_template')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('sites')
      .select('id, customer_id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('code'),
  ])

  const sitesList = (sites ?? []) as SiteOption[]
  const matchedSiteId =
    parsed.site_hint
      ? sitesList.find((s) => s.code?.toUpperCase() === parsed.site_hint)?.id ?? null
      : null

  const { totalsPerYear, workbookYears } = aggregateYearTotals(parsed)

  return {
    ok: true,
    filename,
    parsed,
    customers: (customers ?? []) as CustomerOption[],
    sites: sitesList,
    matchedSiteId,
    parsedYearTotals: totalsPerYear,
    workbookYears,
  }
}

export async function previewExistingCountsAction(
  formData: FormData,
): Promise<{ ok: true; counts: ExistingCounts; hasPriorImport: boolean } | ActionFailure> {
  const parsed = z
    .object({
      customer_id: z.string().uuid(),
      financial_year: z.string().regex(/^\d{4}$/),
      site_id: z.string().uuid().optional(),
    })
    .safeParse({
      customer_id: formData.get('customer_id'),
      financial_year: formData.get('financial_year'),
      site_id: formData.get('site_id') || undefined,
    })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  const year = parseInt(parsed.data.financial_year, 10)
  const yearText = String(year)
  const siteId = parsed.data.site_id ?? null

  // The importer's wipe is site-scoped (per migration 0083). Counts query
  // mirrors that exactly when site_id is supplied, so the "will wipe X"
  // preview is accurate to the actual blast radius.
  // When site_id is absent (customer just picked, site not yet), fall back
  // to customer-wide counts so the user sees something rather than zero.
  const scopeQuery = supabase
    .from('contract_scopes')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
    .eq('financial_year', yearText)
  if (siteId) scopeQuery.eq('site_id', siteId)

  const gapsQuery = supabase
    .from('scope_coverage_gaps')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
    .eq('contract_year', year)
  if (siteId) gapsQuery.eq('site_id', siteId)

  const priorImportsQuery = supabase
    .from('contract_scopes')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
    .eq('financial_year', yearText)
    .not('source_import_id', 'is', null)
  if (siteId) priorImportsQuery.eq('site_id', siteId)

  // Calendar: when site picked, restrict to that site. Otherwise count
  // across all customer's sites (visibility for the "is there anything
  // here" preview).
  let siteIdsForCalendar: string[]
  if (siteId) {
    siteIdsForCalendar = [siteId]
  } else {
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id')
      .eq('customer_id', parsed.data.customer_id)
      .eq('tenant_id', tenantId)
    siteIdsForCalendar = (siteRows ?? []).map((s) => s.id as string)
  }

  const [scopes, gaps, calDated, calNull, priorImports] = await Promise.all([
    scopeQuery,
    gapsQuery,
    siteIdsForCalendar.length > 0
      ? supabase
          .from('pm_calendar')
          .select('id', { count: 'exact', head: true })
          .in('site_id', siteIdsForCalendar)
          .eq('tenant_id', tenantId)
          .gte('start_time', `${yearText}-01-01`)
          .lt('start_time', `${year + 1}-01-01`)
      : Promise.resolve({ count: 0 } as { count: number | null }),
    siteIdsForCalendar.length > 0
      ? supabase
          .from('pm_calendar')
          .select('id', { count: 'exact', head: true })
          .in('site_id', siteIdsForCalendar)
          .eq('tenant_id', tenantId)
          .is('start_time', null)
          .eq('financial_year', yearText)
      : Promise.resolve({ count: 0 } as { count: number | null }),
    priorImportsQuery,
  ])

  return {
    ok: true,
    counts: {
      scopes: scopes.count ?? 0,
      calendar: (calDated.count ?? 0) + (calNull.count ?? 0),
      gaps: gaps.count ?? 0,
    },
    hasPriorImport: (priorImports.count ?? 0) > 0,
  }
}

/**
 * For each JP code in the parsed list, count the active assets at the
 * target site whose job_plan.code matches. Drives the asset-count tie-out
 * column in the preview table.
 */
export async function previewAssetCountsAction(
  formData: FormData,
): Promise<AssetCountsResult | ActionFailure> {
  const parsed = z
    .object({
      site_id: z.string().uuid(),
      jp_codes: z.string(), // comma-separated
    })
    .safeParse({
      site_id: formData.get('site_id'),
      jp_codes: formData.get('jp_codes'),
    })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const codes = parsed.data.jp_codes.split(',').map((c) => c.trim()).filter(Boolean)
  if (codes.length === 0) return { ok: true, countsByJp: {} }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  // Resolve job_plans by code — codes may be tenant-wide (site_id null) or
  // customer-scoped. Match on code regardless and let the asset count
  // do the site-scoping.
  const { data: plans } = await supabase
    .from('job_plans')
    .select('id, code')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .in('code', codes)
  const planIdsByCode: Record<string, string[]> = {}
  for (const p of plans ?? []) {
    const c = (p.code as string) ?? ''
    if (!planIdsByCode[c]) planIdsByCode[c] = []
    planIdsByCode[c].push(p.id as string)
  }

  // Count assets per resolved plan id at this site.
  const countsByJp: Record<string, number> = {}
  for (const code of codes) {
    const ids = planIdsByCode[code] ?? []
    if (ids.length === 0) {
      countsByJp[code] = 0
      continue
    }
    const { count } = await supabase
      .from('assets')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', parsed.data.site_id)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('job_plan_id', ids)
    countsByJp[code] = count ?? 0
  }

  return { ok: true, countsByJp }
}

// ── Commit ──────────────────────────────────────────────────────────────

const commitSchema = z.object({
  customer_id: z.string().uuid(),
  site_id: z.string().uuid(),
  financial_year: z.string().regex(/^\d{4}$/),
  confirm_name: z.string().min(1),
  wipe_first: z.string().optional(),
  expected_y1_total: z.string().optional(),
})

const TIE_OUT_TOLERANCE = 1.0 // dollars

export async function commitImportAction(
  formData: FormData,
): Promise<CommitResult | ActionFailure> {
  const parsedForm = commitSchema.safeParse({
    customer_id: formData.get('customer_id'),
    site_id: formData.get('site_id'),
    financial_year: formData.get('financial_year'),
    confirm_name: formData.get('confirm_name'),
    wipe_first: formData.get('wipe_first') ?? '',
    expected_y1_total: formData.get('expected_y1_total') ?? '',
  })
  if (!parsedForm.success) {
    return { ok: false, error: parsedForm.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { customer_id, site_id, financial_year, confirm_name, wipe_first, expected_y1_total } = parsedForm.data
  const wipeFirst = wipe_first === 'true'
  const expectedY1 = expected_y1_total ? parseFloat(expected_y1_total) : null
  if (expected_y1_total && (expectedY1 === null || !Number.isFinite(expectedY1))) {
    return { ok: false, error: 'Expected Y1 total must be a number.' }
  }

  const fileResult = await readFileFromForm(formData)
  if ('ok' in fileResult && fileResult.ok === false) return fileResult
  const { buffer, filename } = fileResult as { buffer: Buffer; filename: string }

  const { supabase, tenantId, role, user } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  // Customer + site + typed-name verification.
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('id, name, contract_template')
    .eq('id', customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (custErr) return { ok: false, error: custErr.message }
  if (!customer) return { ok: false, error: 'Customer not found.' }
  if ((customer.name ?? '').trim() !== confirm_name.trim()) {
    return { ok: false, error: 'Confirmation name did not match.' }
  }

  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, customer_id, code, name')
    .eq('id', site_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (siteErr) return { ok: false, error: siteErr.message }
  if (!site || site.customer_id !== customer_id) {
    return { ok: false, error: 'Site is not part of this customer.' }
  }

  // Re-parse for commit — xlsx is the source of truth.
  const parsed = await parseCommercialSheet(buffer, filename)
  if (parsed.errors.length > 0) return { ok: false, error: parsed.errors.join(' · ') }
  if (parsed.scopes.length === 0 && parsed.additional_items.length === 0) {
    return { ok: false, error: 'Workbook contained no priced JPs or Additional Items.' }
  }

  const year = parseInt(financial_year, 10)
  const yearText = String(year)

  // Validation: warnings (allowed but logged) vs hard errors (block).
  const hardErrors: string[] = []
  const warnings: string[] = []

  // 1. Customer template vs workbook hint. AU SMCA filename pattern + non-au_smca_v1 customer = warn.
  if (parsed.site_hint && customer.contract_template && customer.contract_template !== 'au_smca_v1') {
    warnings.push(
      `Selected customer has contract_template='${customer.contract_template}' but the filename looks like an AU SMCA workbook (DELTA ELCOM_${parsed.site_hint}). Confirm you've picked the right customer.`,
    )
  }

  // 2. Site-hint mismatch — soft warning.
  if (parsed.site_hint && site.code && site.code.toUpperCase() !== parsed.site_hint) {
    warnings.push(
      `Filename hint says site '${parsed.site_hint}' but you've picked site '${site.code}'. Confirm the right site is targeted.`,
    )
  }

  // 3. Picked year vs workbook years — hard error if year not in any row.
  const { workbookYears } = aggregateYearTotals(parsed)
  if (!workbookYears.includes(yearText)) {
    hardErrors.push(
      `Picked year ${yearText} doesn't appear in any row's year_totals (workbook covers ${workbookYears.join(', ') || 'no years'}). Pick a covered year or upload the right xlsx.`,
    )
  }

  // 4. Y1 tie-out — hard error if user provided expected and parsed differs.
  const parsedY1 = aggregateYearTotals(parsed).totalsPerYear[yearText] ?? 0
  if (expectedY1 !== null) {
    const diff = Math.abs(parsedY1 - expectedY1)
    if (diff > TIE_OUT_TOLERANCE) {
      hardErrors.push(
        `Y1 tie-out failed: parsed total $${parsedY1.toFixed(2)} differs from expected $${expectedY1.toFixed(2)} by $${diff.toFixed(2)} (tolerance $${TIE_OUT_TOLERANCE.toFixed(2)}).`,
      )
    }
  }

  // 5. Duplicate-import detection — block if !wipe AND prior import exists
  // for this site/year. Site-scoped to match the wipe scope (0083 hotfix).
  if (!wipeFirst) {
    const { count: priorCount } = await supabase
      .from('contract_scopes')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customer_id)
      .eq('site_id', site_id)
      .eq('tenant_id', tenantId)
      .eq('financial_year', yearText)
      .not('source_import_id', 'is', null)
    if ((priorCount ?? 0) > 0) {
      hardErrors.push(
        `Site/year already has ${priorCount} contract-scope rows from a prior import. Re-importing without wipe would create duplicates. Enable "Wipe first" or pick a different year.`,
      )
    }
  }

  if (hardErrors.length > 0) {
    return { ok: false, error: hardErrors.join(' · '), warnings }
  }

  // Build payload for the RPC. Every row gets the shared source_import_id.
  const sourceImportId = crypto.randomUUID()
  const buildRow = (s: ParsedScope) => ({
    site_id,
    scope_item: s.scope_item,
    jp_code: s.jp_code ?? '',
    asset_qty: s.asset_qty,
    intervals_text: s.intervals_text,
    billing_basis: s.billing_basis,
    cycle_costs: s.cycle_costs,
    year_totals: s.year_totals,
    due_years: s.due_years,
    labour_hours_per_asset: s.labour_hours_per_asset,
    unit_rate_per_asset: s.unit_rate_per_asset,
    notes: s.notes ?? '',
    source_workbook: filename,
    source_sheet: s.source_sheet,
    source_row: s.source_row,
    source_import_id: sourceImportId,
    has_bundled_scope: s.has_bundled_scope,
    commercial_gap: s.commercial_gap,
  })

  const rows = [...parsed.scopes, ...parsed.additional_items].map(buildRow)

  // Atomic wipe-and-insert via RPC. The function body is one tx — partial
  // failures roll back the wipe.
  const { data: rpcRaw, error: rpcErr } = await supabase.rpc('wipe_and_replace_contract_scopes', {
    p_customer_id: customer_id,
    p_site_id: site_id,
    p_year: year,
    p_rows: rows,
    p_wipe_first: wipeFirst,
  })
  if (rpcErr) return { ok: false, error: `Atomic import failed: ${rpcErr.message}` }

  const rpcResult = (rpcRaw as
    | {
        wiped_scopes?: number
        wiped_calendar?: number
        wiped_gaps?: number
        inserted?: number
        pre_wipe_snapshot?: unknown[]
      }
    | null) ?? {}

  const wiped: ExistingCounts = {
    scopes: rpcResult.wiped_scopes ?? 0,
    calendar: rpcResult.wiped_calendar ?? 0,
    gaps: rpcResult.wiped_gaps ?? 0,
  }

  await logAuditEvent({
    action: 'create',
    entityType: 'customer',
    entityId: customer_id,
    summary:
      `Imported ${parsed.scopes.length} JP + ${parsed.additional_items.length} additional ` +
      `into ${customer.name} (${yearText}) from ${filename}` +
      (wipeFirst ? ` — wiped first (${wiped.scopes} scopes, ${wiped.calendar} calendar, ${wiped.gaps} gaps)` : ''),
    metadata: {
      action_kind: 'commercial_sheet_import',
      financial_year: year,
      site_id,
      site_code: site.code,
      site_name: site.name,
      source_workbook: filename,
      source_import_id: sourceImportId,
      inserted_scopes: parsed.scopes.length,
      inserted_additional_items: parsed.additional_items.length,
      wipe_first: wipeFirst,
      wiped_counts: wiped,
      // Recovery payload: the wiped contract_scopes rows. Keep snapshot
      // bounded by limiting columns in the RPC (jp_code/scope_item/totals).
      pre_wipe_snapshot: rpcResult.pre_wipe_snapshot ?? [],
      // Operator-supplied tie-out (null when skipped).
      expected_y1_total: expectedY1,
      parsed_y1_total: parsedY1,
      tie_out_diff: expectedY1 !== null ? +(parsedY1 - expectedY1).toFixed(2) : null,
      warnings,
      // For auditability
      acted_by_user_id: user.id,
    },
  })

  revalidatePath(`/customers/${customer_id}`)
  revalidatePath('/contract-scope')
  revalidatePath('/calendar')
  revalidatePath('/reports')
  revalidatePath('/dashboard')

  return {
    ok: true,
    inserted: { scopes: parsed.scopes.length, additional_items: parsed.additional_items.length },
    wiped,
    source_import_id: sourceImportId,
  }
}
