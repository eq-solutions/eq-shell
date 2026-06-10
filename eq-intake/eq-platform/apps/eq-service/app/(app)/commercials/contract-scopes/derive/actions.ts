'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'

// ── Types returned to the UI ─────────────────────────────────────────────

export interface DeriveCandidate {
  customer_id: string
  customer_name: string
  customer_code: string | null
  sites: number
  assets: number
  distinct_jps: number
  checks_total: number
  scope_rows: number
  last_check: string | null
}

export interface DerivedScopeRow {
  site_id: string
  site_name: string
  site_code: string | null
  jp_id: string | null
  jp_code: string | null
  jp_name: string | null
  jp_type: string | null
  asset_count: number
  check_count: number
  median_gap_days: number | null
  last_check: string | null
  /** Inferred interval label: M / Q / S / A / 2 / 5 / irregular / unknown */
  derived_interval: string
  /** Visits per year implied by the gap (or 1 when nothing to infer from). */
  visits_per_year: number
  /** Estimated annual hours: asset_count * 0.25 hrs/asset/visit * visits_per_year. */
  estimated_annual_hours: number
  /** Estimated annual cost: hours * customer hourly rate (or $125 default). */
  estimated_annual_cost: number
}

export interface DerivePreviewResult {
  ok: true
  customer: {
    id: string
    name: string
    hourly_rate_normal: number
  }
  rows: DerivedScopeRow[]
}

export type ActionFailure = { ok: false; error: string }

// ── Helpers ──────────────────────────────────────────────────────────────

const DEFAULT_HOURLY_RATE = 125
const HOURS_PER_ASSET_PER_VISIT = 0.25 // rough — operator edits before commit

/**
 * Map a median-gap-days value to an SKS interval label.
 *
 *  M   monthly        ~30 days
 *  Q   quarterly      ~90 days
 *  S   semi-annual    ~180 days
 *  A   annual         ~365 days
 *  2   biennial       ~730 days
 *  5   5-yearly       ~1825 days
 *
 * Anything that doesn't fit a clean cycle returns 'irregular' so the
 * operator can sort it out.
 */
function deriveInterval(medianGapDays: number | null): string {
  if (medianGapDays === null) return 'unknown'
  if (medianGapDays >= 25 && medianGapDays <= 40)   return 'M'
  if (medianGapDays >= 80 && medianGapDays <= 100)  return 'Q'
  if (medianGapDays >= 150 && medianGapDays <= 200) return 'S'
  if (medianGapDays >= 320 && medianGapDays <= 400) return 'A'
  if (medianGapDays >= 700 && medianGapDays <= 800) return '2'
  if (medianGapDays >= 1700 && medianGapDays <= 2000) return '5'
  return 'irregular'
}

function visitsPerYear(medianGapDays: number | null): number {
  if (medianGapDays === null || medianGapDays <= 0) return 1
  return Math.max(0.1, +(365 / medianGapDays).toFixed(2))
}

// ── Action: list customers that are candidates for derivation ────────────

export async function listDeriveCandidatesAction(): Promise<
  { ok: true; candidates: DeriveCandidate[] } | ActionFailure
> {
  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  // Get every active customer + a count of (sites, assets, jps, checks,
  // existing scope rows). A "candidate" is a customer that has assets
  // and/or check history but zero contract_scopes — i.e. we deliver work
  // for them but no formal scope exists yet.
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name, code, contract_template')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name')
  if (error) return { ok: false, error: error.message }

  const candidates: DeriveCandidate[] = []
  for (const c of customers ?? []) {
    const customerId = c.id as string
    const [sitesRes, assetsRes, checksRes, scopesRes, lastCheckRes, jpsRes] = await Promise.all([
      supabase.from('sites').select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId).eq('tenant_id', tenantId).eq('is_active', true),
      supabase.from('assets').select('id, sites!inner(customer_id)', { count: 'exact', head: true })
        .eq('sites.customer_id', customerId).eq('tenant_id', tenantId).eq('is_active', true),
      supabase.from('maintenance_checks').select('id, sites!inner(customer_id)', { count: 'exact', head: true })
        .eq('sites.customer_id', customerId).eq('tenant_id', tenantId),
      supabase.from('contract_scopes').select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId).eq('tenant_id', tenantId),
      supabase.from('maintenance_checks').select('created_at, sites!inner(customer_id)')
        .eq('sites.customer_id', customerId).eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      // distinct_jps via assets — count distinct job_plan_id
      supabase.from('assets').select('job_plan_id, sites!inner(customer_id)')
        .eq('sites.customer_id', customerId).eq('tenant_id', tenantId).eq('is_active', true)
        .not('job_plan_id', 'is', null),
    ])

    const distinctJps = new Set((jpsRes.data ?? []).map((r) => r.job_plan_id as string)).size

    candidates.push({
      customer_id: customerId,
      customer_name: c.name as string,
      customer_code: (c.code as string | null) ?? null,
      sites: sitesRes.count ?? 0,
      assets: assetsRes.count ?? 0,
      distinct_jps: distinctJps,
      checks_total: checksRes.count ?? 0,
      scope_rows: scopesRes.count ?? 0,
      last_check: (lastCheckRes.data?.created_at as string | undefined)?.slice(0, 10) ?? null,
    })
  }

  // Sort: derive-candidates first (assets > 0 and scope_rows = 0), then
  // by asset count descending.
  candidates.sort((a, b) => {
    const ac = a.assets > 0 && a.scope_rows === 0 ? 0 : 1
    const bc = b.assets > 0 && b.scope_rows === 0 ? 0 : 1
    if (ac !== bc) return ac - bc
    return b.assets - a.assets
  })

  return { ok: true, candidates }
}

// ── Action: derive a draft scope for one customer ─────────────────────────

const previewSchema = z.object({
  customer_id: z.string().uuid(),
})

export async function previewDerivedScopeAction(
  formData: FormData,
): Promise<DerivePreviewResult | ActionFailure> {
  const parsed = previewSchema.safeParse({ customer_id: formData.get('customer_id') })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  const customerId = parsed.data.customer_id

  // Customer + hourly rate baseline
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('id, name, hourly_rate_normal')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (custErr) return { ok: false, error: custErr.message }
  if (!customer) return { ok: false, error: 'Customer not found.' }

  const hourlyRate = ((customer.hourly_rate_normal as number | null) ?? DEFAULT_HOURLY_RATE)

  // Per-(site, JP) data: asset count, check history median gap, last check.
  // Two queries instead of one CTE so we don't need a custom RPC just yet.
  const { data: assetGroups, error: agErr } = await supabase
    .from('assets')
    .select(`
      site_id,
      job_plan_id,
      sites!inner(id, name, code, customer_id),
      job_plans!inner(id, code, name, type)
    `)
    .eq('sites.customer_id', customerId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .not('job_plan_id', 'is', null)
  if (agErr) return { ok: false, error: agErr.message }

  // Aggregate to (site_id, jp_id) → count + meta.
  // Supabase's typed select returns embedded relations as either single
  // objects or arrays depending on the FK shape — we coerce through
  // `unknown` and pull the [0] element since our queries are 1:1.
  const agg = new Map<string, {
    site_id: string; site_name: string; site_code: string | null
    jp_id: string; jp_code: string | null; jp_name: string | null; jp_type: string | null
    asset_count: number
  }>()
  type RawAssetRow = {
    site_id: string
    job_plan_id: string
    sites: Array<{ id: string; name: string; code: string | null; customer_id: string }> | { id: string; name: string; code: string | null; customer_id: string } | null
    job_plans: Array<{ id: string; code: string | null; name: string | null; type: string | null }> | { id: string; code: string | null; name: string | null; type: string | null } | null
  }
  for (const row of ((assetGroups ?? []) as unknown) as RawAssetRow[]) {
    const site = Array.isArray(row.sites) ? row.sites[0] : row.sites
    const plan = Array.isArray(row.job_plans) ? row.job_plans[0] : row.job_plans
    if (!site || !plan) continue
    const key = `${row.site_id}::${row.job_plan_id}`
    const existing = agg.get(key)
    if (existing) {
      existing.asset_count += 1
    } else {
      agg.set(key, {
        site_id: row.site_id,
        site_name: site.name,
        site_code: site.code,
        jp_id: row.job_plan_id,
        jp_code: plan.code,
        jp_name: plan.name,
        jp_type: plan.type,
        asset_count: 1,
      })
    }
  }

  // Maintenance check history per (site, jp) for median-gap inference.
  const { data: checks, error: chErr } = await supabase
    .from('maintenance_checks')
    .select('site_id, job_plan_id, created_at, sites!inner(customer_id)')
    .eq('sites.customer_id', customerId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  if (chErr) return { ok: false, error: chErr.message }

  const historyByKey = new Map<string, { dates: string[]; count: number }>()
  type RawCheckRow = { site_id: string; job_plan_id: string | null; created_at: string }
  for (const ck of ((checks ?? []) as unknown) as RawCheckRow[]) {
    if (!ck.job_plan_id) continue
    const key = `${ck.site_id}::${ck.job_plan_id}`
    const entry = historyByKey.get(key) ?? { dates: [], count: 0 }
    entry.dates.push(ck.created_at)
    entry.count += 1
    historyByKey.set(key, entry)
  }

  function median(nums: number[]): number | null {
    if (nums.length === 0) return null
    const sorted = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }

  const rows: DerivedScopeRow[] = []
  for (const [key, group] of agg.entries()) {
    const history = historyByKey.get(key)
    const gaps: number[] = []
    if (history && history.dates.length >= 2) {
      for (let i = 1; i < history.dates.length; i++) {
        const a = new Date(history.dates[i - 1]).getTime()
        const b = new Date(history.dates[i]).getTime()
        gaps.push((b - a) / (24 * 60 * 60 * 1000))
      }
    }
    const medianGap = median(gaps)
    const interval = deriveInterval(medianGap)
    const vpy = visitsPerYear(medianGap)
    const hoursPerVisit = group.asset_count * HOURS_PER_ASSET_PER_VISIT
    const annualHours = +(hoursPerVisit * vpy).toFixed(1)
    const annualCost = Math.round(annualHours * hourlyRate)

    rows.push({
      site_id: group.site_id,
      site_name: group.site_name,
      site_code: group.site_code,
      jp_id: group.jp_id,
      jp_code: group.jp_code,
      jp_name: group.jp_name,
      jp_type: group.jp_type,
      asset_count: group.asset_count,
      check_count: history?.count ?? 0,
      median_gap_days: medianGap !== null ? Math.round(medianGap) : null,
      last_check: history && history.dates.length > 0
        ? history.dates[history.dates.length - 1].slice(0, 10)
        : null,
      derived_interval: interval,
      visits_per_year: vpy,
      estimated_annual_hours: annualHours,
      estimated_annual_cost: annualCost,
    })
  }

  // Sort: site_code, then jp_code
  rows.sort((a, b) => {
    const sc = (a.site_code ?? '').localeCompare(b.site_code ?? '')
    if (sc !== 0) return sc
    return (a.jp_code ?? '').localeCompare(b.jp_code ?? '')
  })

  return {
    ok: true,
    customer: { id: customer.id as string, name: customer.name as string, hourly_rate_normal: hourlyRate },
    rows,
  }
}

// ── Action: commit derived scopes as draft contract_scopes rows ──────────

const commitRowSchema = z.object({
  site_id: z.string().uuid(),
  jp_id: z.string().uuid(),
  jp_code: z.string().nullable(),
  jp_name: z.string().nullable(),
  asset_count: z.number().int().min(0),
  derived_interval: z.string(),
  estimated_annual_cost: z.number().min(0),
  estimated_annual_hours: z.number().min(0),
  notes: z.string().nullable(),
})

const commitSchema = z.object({
  customer_id: z.string().uuid(),
  financial_year: z.string().regex(/^\d{4}$/, 'Year must be YYYY.'),
  rows: z.string(), // JSON-encoded array of commitRowSchema
})

export async function commitDerivedScopesAction(
  formData: FormData,
): Promise<{ ok: true; inserted: number; source_import_id: string } | ActionFailure> {
  const parsed = commitSchema.safeParse({
    customer_id: formData.get('customer_id'),
    financial_year: formData.get('financial_year'),
    rows: formData.get('rows'),
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  let rowsRaw: unknown
  try {
    rowsRaw = JSON.parse(parsed.data.rows)
  } catch {
    return { ok: false, error: 'Could not parse rows JSON.' }
  }
  const rowsParsed = z.array(commitRowSchema).safeParse(rowsRaw)
  if (!rowsParsed.success) return { ok: false, error: rowsParsed.error.issues[0]?.message ?? 'Invalid row.' }

  const { supabase, tenantId, role, user } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  // Customer guard
  const { data: customer } = await supabase
    .from('customers')
    .select('id, name')
    .eq('id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!customer) return { ok: false, error: 'Customer not found.' }

  const sourceImportId = crypto.randomUUID()
  const yearText = parsed.data.financial_year
  const importedAt = new Date().toISOString()

  const inserts = rowsParsed.data.map((r) => ({
    tenant_id: tenantId,
    customer_id: parsed.data.customer_id,
    site_id: r.site_id,
    financial_year: yearText,
    scope_item: r.jp_name ?? r.jp_code ?? 'Derived scope',
    is_included: true,
    jp_code: r.jp_code,
    asset_qty: r.asset_count,
    intervals_text: r.derived_interval,
    billing_basis: 'fixed' as const,
    cycle_costs: {} as Record<string, number>,
    year_totals: { [yearText]: r.estimated_annual_cost } as Record<string, number>,
    due_years: {} as Record<string, number>,
    labour_hours_per_asset:
      r.derived_interval === 'A' ? { A: +(r.estimated_annual_hours / Math.max(1, r.asset_count)).toFixed(2) }
      : {} as Record<string, number>,
    unit_rate_per_asset: null as number | null,
    notes: r.notes ?? `Derived from delivered work; review before committing. Estimate based on ${r.asset_count} assets × ${r.derived_interval} cycle.`,
    source_workbook: 'derived from delivered work',
    source_sheet: `as-at-${importedAt.slice(0, 10)}`,
    source_row: null as number | null,
    imported_at: importedAt,
    source_import_id: sourceImportId,
    has_bundled_scope: false,
    commercial_gap: false,
    // Land as 'draft' so the operator must consciously promote to 'committed'
    // before the importer-style flows treat them as authoritative.
    period_status: 'draft' as const,
    status: 'staged' as const,
  }))

  if (inserts.length === 0) return { ok: false, error: 'No rows to commit.' }

  const { error: insErr } = await supabase.from('contract_scopes').insert(inserts)
  if (insErr) return { ok: false, error: `Insert: ${insErr.message}` }

  await logAuditEvent({
    action: 'create',
    entityType: 'customer',
    entityId: parsed.data.customer_id,
    summary:
      `Derived ${inserts.length} draft contract scope row${inserts.length === 1 ? '' : 's'} for ${customer.name} (${yearText}) ` +
      `from delivered work — review on /contract-scope before committing.`,
    metadata: {
      action_kind: 'contract_scope_derive',
      financial_year: parseInt(yearText, 10),
      source_import_id: sourceImportId,
      inserted_count: inserts.length,
      acted_by_user_id: user.id,
    },
  })

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  revalidatePath('/contract-scope')

  return { ok: true, inserted: inserts.length, source_import_id: sourceImportId }
}
