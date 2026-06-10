'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { closestMatch } from '@/lib/utils/levenshtein'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency, type ActionResult } from '@/lib/actions/idempotency'
import {
  parseWorkbook,
  type DeltaRow,
  type FrequencyEnum,
  type ParsedGroup,
} from '@/lib/import/delta-wo-parser'
import { deltaRowToCheckAssetInsert } from '@/lib/import/delta-row-mapping'

/**
 * Map an EQ frequency enum to the boolean flag column on `job_plan_items`.
 * Kept in sync with `freqColumn` in `app/(app)/maintenance/actions.ts`.
 * Unknown / missing frequencies fall back to `freq_monthly` — defensive
 * default, but the commit action refuses null frequencies before reaching
 * this function.
 */
function freqColumn(freq: string | null): string {
  const map: Record<string, string> = {
    monthly: 'freq_monthly',
    quarterly: 'freq_quarterly',
    semi_annual: 'freq_semi_annual',
    annual: 'freq_annual',
    '2yr': 'freq_2yr',
    '3yr': 'freq_3yr',
    '5yr': 'freq_5yr',
    '8yr': 'freq_8yr',
    '10yr': 'freq_10yr',
  }
  return (freq && map[freq]) ?? 'freq_monthly'
}

// ── Types returned to the UI ────────────────────────────────────────────

/** One asset row within a group preview. */
export interface PreviewAsset {
  rowNumber: number
  workOrder: string
  maximoAssetId: string
  description: string
  location: string | null
  /** Matched EQ asset id or null when no asset with this maximo_id exists. */
  resolvedAssetId: string | null
  /** EQ asset name (for display) when resolved. */
  resolvedAssetName: string | null
  /** WO# already exists on another check_asset for this tenant. */
  duplicateWorkOrder: boolean
  warnings: string[]
}

/** One planned maintenance check — mirrors one `ParsedGroup`. */
export interface PreviewGroup {
  key: string
  siteCode: string
  /** Resolved EQ sites.id or null (site code not found under tenant). */
  siteId: string | null
  siteName: string | null

  jobPlanCodeRaw: string
  /**
   * The code used to query job_plans. Same as `jobPlanCodeRaw` unless an
   * alias or fuzzy candidate is applied/suggested.
   */
  jobPlanCode: string
  /** Matched EQ job_plans row when code exists under the tenant. */
  jobPlanId: string | null
  jobPlanName: string | null

  /** Where the match came from (helps the UI explain itself). */
  matchSource: 'exact' | 'alias' | 'fuzzy' | 'none'
  /** Fuzzy candidate when `matchSource = 'fuzzy'` or suggestion only. */
  fuzzyCandidate: { code: string; distance: number } | null

  frequencySuffix: string
  frequency: FrequencyEnum | null
  /** ISO date (YYYY-MM-DD) — the common Target Start for this group. */
  startDate: string

  assets: PreviewAsset[]
  assetCount: number
  matchedAssetCount: number
  unmatchedAssetCount: number
  duplicateWorkOrderCount: number

  /** Group-level issues bubbled up for quick scanning in the UI. */
  issues: string[]
}

export interface PreviewResult {
  success: true
  filename: string
  parsedRowCount: number
  /** Workbook-level or row-level hard failures from the parser. */
  parseErrors: { rowNumber: number; message: string }[]
  /** Groups sorted by asset count descending. */
  groups: PreviewGroup[]
  /** Unique codes that could not be matched — surface for "add or ignore" prompts. */
  unresolvedJobPlanCodes: string[]
  /** Site codes present in the sheet but not in EQ for this tenant. */
  unresolvedSiteCodes: string[]
}

export type PreviewActionResult =
  | PreviewResult
  | { success: false; error: string }

// ── Resolutions — per-group user choices from the review UI ─────────────

/**
 * A user's decision about how to resolve a group whose job-plan code didn't
 * match exactly / via alias. Keyed by `PreviewGroup.key` on the client.
 *
 * `accept`   — take the fuzzy candidate the preview suggested (adds alias)
 * `nominate` — user picked a specific existing plan from the combobox
 *              (adds alias `rawCode → jobPlanId`)
 * `create`   — create a new tenant-global plan with the supplied code/name,
 *              then alias the raw code to it
 * `skip`     — don't import this group at all
 */
export type GroupResolution =
  | { action: 'accept' }
  | { action: 'nominate'; jobPlanId: string }
  | { action: 'create'; code: string; name: string; type?: string | null }
  | { action: 'skip' }

const ResolutionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({
    action: z.literal('nominate'),
    jobPlanId: z.string().uuid('Invalid maintenance plan id'),
  }),
  z.object({
    action: z.literal('create'),
    code: z.string().trim().min(1, 'Code is required').max(50),
    name: z.string().trim().min(1, 'Name is required').max(200),
    type: z.string().max(200).nullable().optional(),
  }),
  z.object({ action: z.literal('skip') }),
])

const ResolutionsMapSchema = z.record(z.string(), ResolutionSchema)

// ── Row-level resolutions — per unmatched-asset-row user choices ────────

/**
 * A user's decision for an unmatched row within a group.
 * Keyed on the client as `${PreviewGroup.key}:${PreviewAsset.rowNumber}`.
 *
 * `link`   — link this row to an existing tenant asset (user-picked)
 * `create` — insert a new asset using the row's maximo_id / description /
 *            location as defaults; no inline edits
 * `skip`   — drop this row (no check_asset created for this work order)
 */
export type RowResolution =
  | { action: 'link'; assetId: string }
  | { action: 'create' }
  | { action: 'skip' }

const RowResolutionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), assetId: z.string().uuid('Invalid asset id') }),
  z.object({ action: z.literal('create') }),
  z.object({ action: z.literal('skip') }),
])

const RowResolutionsMapSchema = z.record(z.string(), RowResolutionSchema)

/**
 * Lightweight list of active tenant assets at a given site for the "Link to
 * existing asset" combobox. Role-gated and tenant/site-scoped.
 */
export async function listAssetsForSiteAction(
  siteId: string,
): Promise<
  | { success: true; assets: { id: string; name: string; maximoId: string | null; location: string | null }[] }
  | { success: false; error: string }
> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }
    const parsed = z.string().uuid().safeParse(siteId)
    if (!parsed.success) {
      return { success: false, error: 'Invalid site id.' }
    }
    const { data, error } = await supabase
      .from('assets')
      .select('id, name, maximo_id, location')
      .eq('tenant_id', tenantId)
      .eq('site_id', siteId)
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (error) return { success: false, error: error.message }
    return {
      success: true,
      assets: (data ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        maximoId: a.maximo_id ?? null,
        location: a.location ?? null,
      })),
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Lightweight list of active tenant maintenance plans for the import-review combobox
 * when the user picks "Nominate existing plan". Read-only and role-gated
 * consistent with the rest of the import flow.
 */
export async function listJobPlansForImportAction(): Promise<
  | { success: true; plans: { id: string; code: string | null; name: string; type: string | null }[] }
  | { success: false; error: string }
> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }
    const { data, error } = await supabase
      .from('job_plans')
      .select('id, code, name, type')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('code', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })

    if (error) return { success: false, error: error.message }
    return {
      success: true,
      plans: (data ?? []).map((p) => ({
        id: p.id,
        code: p.code ?? null,
        name: p.name,
        type: p.type ?? null,
      })),
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Action ──────────────────────────────────────────────────────────────

/**
 * Read-only preview of a Delta / Equinix Maximo work-order workbook.
 *
 * Parses the file, resolves sites / maintenance plans / assets against the current
 * tenant, applies any known `job_plan_aliases`, and returns a structured
 * preview the UI can render into an import wizard. Writes nothing — the
 * commit happens in a separate action once the user confirms.
 *
 * Caller must pass a FormData with a single `file` entry.
 */
export async function previewDeltaImportAction(
  formData: FormData,
): Promise<PreviewActionResult> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }
    const filename = file.name || 'upload.xlsx'

    // ── Parse workbook ────────────────────────────────────────────────
    const buf = Buffer.from(await file.arrayBuffer())
    const { rows, groups, errors } = await parseWorkbook(buf)

    if (rows.length === 0) {
      return {
        success: true,
        filename,
        parsedRowCount: 0,
        parseErrors: errors,
        groups: [],
        unresolvedJobPlanCodes: [],
        unresolvedSiteCodes: [],
      }
    }

    // ── Resolve sites (siteCode → sites.id, tenant-scoped) ────────────
    const siteCodes = Array.from(new Set(rows.map((r) => r.siteCode)))
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('code', siteCodes)

    const siteByCode = new Map<string, { id: string; name: string }>()
    for (const s of siteRows ?? []) {
      if (s.code) siteByCode.set(s.code, { id: s.id, name: s.name })
    }

    // ── Resolve maintenance plans (all active, tenant-scoped) ─────────────────
    // We pull every active job_plan with a non-null code for this tenant and
    // build lookup tables. Cheap, one round-trip, avoids N queries below.
    const { data: jpRows } = await supabase
      .from('job_plans')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .not('code', 'is', null)

    const jpByCode = new Map<string, { id: string; name: string }>()
    const allCodes: string[] = []
    for (const jp of jpRows ?? []) {
      if (!jp.code) continue
      jpByCode.set(jp.code, { id: jp.id, name: jp.name })
      allCodes.push(jp.code)
    }

    // ── Load aliases for this tenant (source_system='delta') ──────────
    const { data: aliasRows } = await supabase
      .from('job_plan_aliases')
      .select('external_code, job_plan_id')
      .eq('tenant_id', tenantId)
      .eq('source_system', 'delta')

    // Map alias → job_plan row
    const aliasMap = new Map<string, { id: string; code: string; name: string }>()
    if (aliasRows && aliasRows.length > 0) {
      const aliasIds = Array.from(
        new Set(aliasRows.map((a) => a.job_plan_id).filter(Boolean)),
      ) as string[]
      if (aliasIds.length > 0) {
        const { data: aliasTargets } = await supabase
          .from('job_plans')
          .select('id, code, name')
          .in('id', aliasIds)
        const targetById = new Map<string, { id: string; code: string; name: string }>()
        for (const t of aliasTargets ?? []) {
          if (t.code) targetById.set(t.id, { id: t.id, code: t.code, name: t.name })
        }
        for (const a of aliasRows) {
          const target = targetById.get(a.job_plan_id)
          if (target) aliasMap.set(a.external_code, target)
        }
      }
    }

    // ── Resolve assets by (site_id, maximo_id) ────────────────────────
    const resolvedSiteIds = Array.from(siteByCode.values()).map((s) => s.id)
    const maximoIds = Array.from(new Set(rows.map((r) => r.maximoAssetId)))

    const assetByKey = new Map<string, { id: string; name: string }>() // key = `${siteId}|${maximoId}`
    if (resolvedSiteIds.length > 0 && maximoIds.length > 0) {
      const { data: assetRows } = await supabase
        .from('assets')
        .select('id, name, site_id, maximo_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('site_id', resolvedSiteIds)
        .in('maximo_id', maximoIds)

      for (const a of assetRows ?? []) {
        if (!a.maximo_id) continue
        assetByKey.set(`${a.site_id}|${a.maximo_id}`, { id: a.id, name: a.name })
      }
    }

    // ── Detect duplicate work orders (tenant-scoped) ──────────────────
    const incomingWOs = Array.from(new Set(rows.map((r) => r.workOrder)))
    const existingWO = new Set<string>()
    if (incomingWOs.length > 0) {
      const { data: dupRows } = await supabase
        .from('check_assets')
        .select('work_order_number')
        .eq('tenant_id', tenantId)
        .in('work_order_number', incomingWOs)
      for (const d of dupRows ?? []) {
        if (d.work_order_number) existingWO.add(d.work_order_number)
      }
    }

    // ── Build preview groups ──────────────────────────────────────────
    const unresolvedJobPlanCodesSet = new Set<string>()
    const unresolvedSiteCodesSet = new Set<string>()

    const previewGroups: PreviewGroup[] = groups.map((g) =>
      buildPreviewGroup(g, {
        siteByCode,
        jpByCode,
        aliasMap,
        allCodes,
        assetByKey,
        existingWO,
        unresolvedJobPlanCodesSet,
        unresolvedSiteCodesSet,
      }),
    )

    return {
      success: true,
      filename,
      parsedRowCount: rows.length,
      parseErrors: errors,
      groups: previewGroups,
      unresolvedJobPlanCodes: Array.from(unresolvedJobPlanCodesSet).sort(),
      unresolvedSiteCodes: Array.from(unresolvedSiteCodesSet).sort(),
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

interface BuildContext {
  siteByCode: Map<string, { id: string; name: string }>
  jpByCode: Map<string, { id: string; name: string }>
  aliasMap: Map<string, { id: string; code: string; name: string }>
  allCodes: string[]
  assetByKey: Map<string, { id: string; name: string }>
  existingWO: Set<string>
  unresolvedJobPlanCodesSet: Set<string>
  unresolvedSiteCodesSet: Set<string>
}

function buildPreviewGroup(g: ParsedGroup, ctx: BuildContext): PreviewGroup {
  const issues: string[] = []

  // Site resolution
  const site = ctx.siteByCode.get(g.siteCode) ?? null
  if (!site) {
    ctx.unresolvedSiteCodesSet.add(g.siteCode)
    issues.push(`Site "${g.siteCode}" not found under this tenant.`)
  }

  // Frequency
  if (!g.frequency) {
    issues.push(
      `Unknown frequency suffix "${g.frequencySuffix}" — manual frequency required.`,
    )
  }

  // Job-plan resolution: exact → alias → fuzzy → none
  let jobPlanCode = g.jobPlanCode
  let jpMatch: { id: string; name: string } | null = ctx.jpByCode.get(jobPlanCode) ?? null
  let matchSource: PreviewGroup['matchSource'] = jpMatch ? 'exact' : 'none'
  let fuzzyCandidate: { code: string; distance: number } | null = null

  if (!jpMatch) {
    // Alias lookup — upstream code → canonical EQ code
    const alias = ctx.aliasMap.get(jobPlanCode)
    if (alias) {
      jpMatch = { id: alias.id, name: alias.name }
      jobPlanCode = alias.code
      matchSource = 'alias'
    }
  }

  if (!jpMatch) {
    // Fuzzy suggestion only — we do NOT auto-apply fuzzy matches; the UI
    // will prompt the user to confirm before the alias is created.
    const near = closestMatch(g.jobPlanCode, ctx.allCodes, 2)
    if (near && near.distance > 0) {
      fuzzyCandidate = { code: near.value, distance: near.distance }
      matchSource = 'fuzzy'
    }
    ctx.unresolvedJobPlanCodesSet.add(g.jobPlanCode)
    issues.push(
      fuzzyCandidate
        ? `Job plan "${g.jobPlanCode}" not found — did you mean "${fuzzyCandidate.code}"?`
        : `Job plan "${g.jobPlanCode}" not found in EQ.`,
    )
  }

  // Asset resolution per row
  const assets: PreviewAsset[] = g.rows.map((r) => resolveRow(r, site?.id ?? null, ctx))
  const matchedAssetCount = assets.filter((a) => a.resolvedAssetId !== null).length
  const unmatchedAssetCount = assets.length - matchedAssetCount
  const duplicateWorkOrderCount = assets.filter((a) => a.duplicateWorkOrder).length

  if (unmatchedAssetCount > 0 && site) {
    issues.push(
      `${unmatchedAssetCount} asset${unmatchedAssetCount === 1 ? '' : 's'} could not be matched by maximo_id at ${g.siteCode}.`,
    )
  }
  if (duplicateWorkOrderCount > 0) {
    issues.push(
      `${duplicateWorkOrderCount} work order${duplicateWorkOrderCount === 1 ? '' : 's'} already exist in EQ.`,
    )
  }

  return {
    key: g.key,
    siteCode: g.siteCode,
    siteId: site?.id ?? null,
    siteName: site?.name ?? null,

    jobPlanCodeRaw: g.jobPlanCode,
    jobPlanCode,
    jobPlanId: jpMatch?.id ?? null,
    jobPlanName: jpMatch?.name ?? null,

    matchSource,
    fuzzyCandidate,

    frequencySuffix: g.frequencySuffix,
    frequency: g.frequency,
    startDate: g.startDate.toISOString().slice(0, 10),

    assets,
    assetCount: assets.length,
    matchedAssetCount,
    unmatchedAssetCount,
    duplicateWorkOrderCount,
    issues,
  }
}

function resolveRow(
  r: DeltaRow,
  siteId: string | null,
  ctx: BuildContext,
): PreviewAsset {
  const warnings = [...r.warnings]
  const duplicateWorkOrder = ctx.existingWO.has(r.workOrder)

  let resolvedAssetId: string | null = null
  let resolvedAssetName: string | null = null
  if (siteId) {
    const match = ctx.assetByKey.get(`${siteId}|${r.maximoAssetId}`)
    if (match) {
      resolvedAssetId = match.id
      resolvedAssetName = match.name
    } else {
      warnings.push(`No EQ asset with maximo_id=${r.maximoAssetId} at ${r.siteCode}`)
    }
  }

  if (duplicateWorkOrder) {
    warnings.push(`Work order ${r.workOrder} already exists in EQ`)
  }

  return {
    rowNumber: r.rowNumber,
    workOrder: r.workOrder,
    maximoAssetId: r.maximoAssetId,
    description: r.description,
    location: r.location,
    resolvedAssetId,
    resolvedAssetName,
    duplicateWorkOrder,
    warnings,
  }
}

// ── Commit action ───────────────────────────────────────────────────────

export interface CommitSummary {
  checksCreated: number
  checkAssetsCreated: number
  checkItemsCreated: number
  /** Row-level resolutions applied during commit. */
  rowsLinked: number
  rowsCreated: number
  rowsSkipped: number
  groupsCreated: {
    key: string
    checkId: string
    customName: string
    siteCode: string
    jobPlanCode: string
    frequency: FrequencyEnum
    startDate: string
    assetCount: number
    taskCount: number
  }[]
}

export type CommitActionResult = ActionResult<CommitSummary>

/**
 * Commit a previewed Delta import. The caller must upload the SAME workbook
 * that was previewed — we re-parse and re-resolve server-side (the preview
 * payload is not trusted) and refuse if any group still has unresolved
 * sites, codes, frequencies, unmatched assets, or duplicate work orders.
 *
 * Wrapped in `withIdempotency(mutationId)` so a client-side retry or offline
 * replay is safe. The audit row carries the same `mutationId`, and the
 * unique index on `check_assets(tenant_id, work_order_number)` is the
 * database-level backstop if two replays race past the app check.
 */
export async function commitDeltaImportAction(
  formData: FormData,
  mutationId?: string,
): Promise<CommitActionResult> {
  return withIdempotency<CommitSummary>(mutationId, async () => {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }

    // Optional — caller may pass assigned_to to default-assign every created
    // check. Omitted means unassigned.
    const assignedToRaw = formData.get('assigned_to')
    const assignedTo =
      typeof assignedToRaw === 'string' && assignedToRaw.trim().length > 0
        ? assignedToRaw.trim()
        : null

    // Optional — per-group resolutions collected in the review UI.
    // Shape: Record<groupKey, GroupResolution>. We re-parse the JSON here and
    // validate with Zod so the client can't forge extra fields.
    let resolutions: Record<string, GroupResolution> = {}
    const resolutionsRaw = formData.get('resolutions')
    if (typeof resolutionsRaw === 'string' && resolutionsRaw.trim().length > 0) {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(resolutionsRaw)
      } catch {
        return { success: false, error: 'Invalid resolutions payload — expected JSON.' }
      }
      const parsed = ResolutionsMapSchema.safeParse(parsedJson)
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid resolution: ${parsed.error.issues[0]?.message ?? 'bad payload'}`,
        }
      }
      resolutions = parsed.data
    }

    // Optional — per-row resolutions collected in the review UI.
    // Shape: Record<`${groupKey}:${rowNumber}`, RowResolution>.
    let rowResolutions: Record<string, RowResolution> = {}
    const rowResolutionsRaw = formData.get('rowResolutions')
    if (typeof rowResolutionsRaw === 'string' && rowResolutionsRaw.trim().length > 0) {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rowResolutionsRaw)
      } catch {
        return { success: false, error: 'Invalid rowResolutions payload — expected JSON.' }
      }
      const parsed = RowResolutionsMapSchema.safeParse(parsedJson)
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid row resolution: ${parsed.error.issues[0]?.message ?? 'bad payload'}`,
        }
      }
      rowResolutions = parsed.data
    }

    // ── Parse ─────────────────────────────────────────────────────────
    const buf = Buffer.from(await file.arrayBuffer())
    const { rows, groups, errors } = await parseWorkbook(buf)
    if (errors.length > 0) {
      return {
        success: false,
        error: `Parse produced ${errors.length} error(s). Fix the sheet and retry.`,
      }
    }
    if (rows.length === 0 || groups.length === 0) {
      return { success: false, error: 'No importable rows found in workbook.' }
    }

    // ── Resolve (same lookups as the preview) ─────────────────────────
    const siteCodes = Array.from(new Set(rows.map((r) => r.siteCode)))
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('code', siteCodes)

    const siteByCode = new Map<string, { id: string; name: string }>()
    for (const s of siteRows ?? []) {
      if (s.code) siteByCode.set(s.code, { id: s.id, name: s.name })
    }

    const { data: jpRows } = await supabase
      .from('job_plans')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .not('code', 'is', null)

    const jpByCode = new Map<string, { id: string; name: string }>()
    for (const jp of jpRows ?? []) {
      if (jp.code) jpByCode.set(jp.code, { id: jp.id, name: jp.name })
    }

    const { data: aliasRows } = await supabase
      .from('job_plan_aliases')
      .select('external_code, job_plan_id')
      .eq('tenant_id', tenantId)
      .eq('source_system', 'delta')

    const aliasMap = new Map<string, { id: string; code: string; name: string }>()
    if (aliasRows && aliasRows.length > 0) {
      const aliasIds = Array.from(
        new Set(aliasRows.map((a) => a.job_plan_id).filter(Boolean)),
      ) as string[]
      if (aliasIds.length > 0) {
        const { data: aliasTargets } = await supabase
          .from('job_plans')
          .select('id, code, name')
          .in('id', aliasIds)
        const byId = new Map<string, { id: string; code: string; name: string }>()
        for (const t of aliasTargets ?? []) {
          if (t.code) byId.set(t.id, { id: t.id, code: t.code, name: t.name })
        }
        for (const a of aliasRows) {
          const target = byId.get(a.job_plan_id)
          if (target) aliasMap.set(a.external_code, target)
        }
      }
    }

    // ── Apply user resolutions from the review UI ────────────────────
    // We mutate upfront (create plans, write aliases) so the existing
    // validation pass below picks them up via `jpByCode` / `aliasMap`.
    // Skipped groups are dropped from the working set by key.
    const skippedKeys = new Set<string>()
    const aliasesCreated: { externalCode: string; jobPlanId: string }[] = []
    const plansCreated: { id: string; code: string; name: string }[] = []

    const jpByLowerCode = new Map<string, string>()
    for (const [k, v] of jpByCode) jpByLowerCode.set(k.toLowerCase(), v.id)

    for (const g of groups) {
      const resolution = resolutions[g.key]
      if (!resolution) continue

      // Skip — dropped before validation.
      if (resolution.action === 'skip') {
        skippedKeys.add(g.key)
        continue
      }

      // If the raw code already resolves (exact or via existing alias),
      // the resolution is a no-op. Don't write a duplicate alias.
      const alreadyResolved = jpByCode.has(g.jobPlanCode) || aliasMap.has(g.jobPlanCode)
      if (alreadyResolved && resolution.action !== 'create') {
        continue
      }

      // Determine the target job_plan_id for alias insertion.
      let targetJobPlanId: string | null = null
      let targetCode: string | null = null
      let targetName: string | null = null

      if (resolution.action === 'accept') {
        const near = closestMatch(g.jobPlanCode, Array.from(jpByCode.keys()), 2)
        if (!near) {
          return {
            success: false,
            error: `Cannot accept fuzzy match for "${g.jobPlanCode}" — no close candidate found.`,
          }
        }
        const jp = jpByCode.get(near.value)
        if (!jp) {
          return {
            success: false,
            error: `Fuzzy candidate "${near.value}" no longer exists — re-preview the import.`,
          }
        }
        targetJobPlanId = jp.id
        targetCode = near.value
        targetName = jp.name
      } else if (resolution.action === 'nominate') {
        // Look up the nominated plan to confirm it belongs to this tenant and
        // is active (RLS will also enforce this, but we want a clean error).
        const { data: plan, error: planErr } = await supabase
          .from('job_plans')
          .select('id, code, name')
          .eq('id', resolution.jobPlanId)
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .maybeSingle()
        if (planErr || !plan) {
          return {
            success: false,
            error: `Nominated maintenance plan not found or inactive (group ${g.siteCode}/${g.jobPlanCode}).`,
          }
        }
        targetJobPlanId = plan.id
        targetCode = plan.code ?? g.jobPlanCode
        targetName = plan.name
      } else if (resolution.action === 'create') {
        // Guard against colliding with an existing code (case-insensitive)
        // under this tenant — if it already exists, the user should have
        // picked Nominate instead.
        const lower = resolution.code.trim().toLowerCase()
        const existingId = jpByLowerCode.get(lower)
        if (existingId) {
          return {
            success: false,
            error: `Cannot create plan "${resolution.code}" — a plan with that code already exists under this tenant. Use "Nominate existing" instead.`,
          }
        }

        const { data: newPlan, error: createErr } = await supabase
          .from('job_plans')
          .insert({
            tenant_id: tenantId,
            site_id: null, // tenant-global, consistent with E1.25 convention
            name: resolution.name.trim(),
            code: resolution.code.trim(),
            type: resolution.type?.trim() || null,
            is_active: true,
          })
          .select('id, code, name')
          .single()

        if (createErr || !newPlan) {
          return {
            success: false,
            error: createErr?.message ?? 'Failed to create maintenance plan.',
          }
        }
        const newCode: string = newPlan.code ?? resolution.code.trim()
        targetJobPlanId = newPlan.id
        targetCode = newCode
        targetName = newPlan.name
        plansCreated.push({ id: newPlan.id, code: newCode, name: newPlan.name })

        // Keep local lookups consistent for the rest of this commit pass.
        jpByCode.set(newCode, { id: newPlan.id, name: newPlan.name })
        jpByLowerCode.set(lower, newPlan.id)
      }

      if (!targetJobPlanId || !targetCode || !targetName) {
        return {
          success: false,
          error: `Could not resolve target plan for group ${g.siteCode}/${g.jobPlanCode}.`,
        }
      }

      // Insert the alias so future imports auto-match the raw Maximo code.
      // Use upsert on (tenant_id, source_system, external_code) for replay
      // safety — same commit retried with same resolutions is a no-op.
      const { error: aliasErr } = await supabase
        .from('job_plan_aliases')
        .upsert(
          {
            tenant_id: tenantId,
            source_system: 'delta',
            external_code: g.jobPlanCode,
            job_plan_id: targetJobPlanId,
            created_by: user.id,
          },
          { onConflict: 'tenant_id,source_system,external_code' },
        )
      if (aliasErr) {
        return { success: false, error: `Failed to create alias: ${aliasErr.message}` }
      }

      aliasMap.set(g.jobPlanCode, { id: targetJobPlanId, code: targetCode, name: targetName })
      aliasesCreated.push({ externalCode: g.jobPlanCode, jobPlanId: targetJobPlanId })
    }

    // Drop skipped groups from the working set before the validation pass.
    const workingGroups = groups.filter((g) => !skippedKeys.has(g.key))
    if (workingGroups.length === 0) {
      return {
        success: false,
        error: 'No groups selected — every group was skipped.',
      }
    }

    // Resolved group metadata — populated in the validation pass below.
    // Site / asset / WO lookups are scoped to the working groups (i.e. after
    // skip filtering) to avoid work on rows that won't be imported.
    const workingRows = workingGroups.flatMap((g) => g.rows)
    const resolvedSiteIds = Array.from(siteByCode.values()).map((s) => s.id)
    const maximoIds = Array.from(new Set(workingRows.map((r) => r.maximoAssetId)))
    const assetByKey = new Map<string, { id: string; name: string }>()
    if (resolvedSiteIds.length > 0 && maximoIds.length > 0) {
      const { data: assetRows } = await supabase
        .from('assets')
        .select('id, name, site_id, maximo_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('site_id', resolvedSiteIds)
        .in('maximo_id', maximoIds)
      for (const a of assetRows ?? []) {
        if (a.maximo_id) assetByKey.set(`${a.site_id}|${a.maximo_id}`, { id: a.id, name: a.name })
      }
    }

    const incomingWOs = Array.from(new Set(workingRows.map((r) => r.workOrder)))
    const existingWO = new Set<string>()
    if (incomingWOs.length > 0) {
      const { data: dupRows } = await supabase
        .from('check_assets')
        .select('work_order_number')
        .eq('tenant_id', tenantId)
        .in('work_order_number', incomingWOs)
      for (const d of dupRows ?? []) {
        if (d.work_order_number) existingWO.add(d.work_order_number)
      }
    }

    // ── Validate every working group ──────────────────────────────────
    interface ResolvedGroup {
      parsed: ParsedGroup
      siteId: string
      siteName: string
      jobPlanId: string
      jobPlanName: string
      frequency: FrequencyEnum
      assetIdByRow: Map<number, string>
      /** Row numbers explicitly skipped via rowResolutions — excluded from check_assets. */
      skippedRowNumbers: Set<number>
    }

    const resolved: ResolvedGroup[] = []
    const blockers: string[] = []

    let rowsLinked = 0
    let rowsCreated = 0
    let rowsSkipped = 0

    for (const g of workingGroups) {
      const site = siteByCode.get(g.siteCode)
      if (!site) {
        blockers.push(`Site "${g.siteCode}" not found`)
        continue
      }
      if (!g.frequency) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}/${g.frequencySuffix}: unknown frequency`)
        continue
      }

      let jp = jpByCode.get(g.jobPlanCode) ?? null
      if (!jp) {
        const alias = aliasMap.get(g.jobPlanCode)
        if (alias) jp = { id: alias.id, name: alias.name }
      }
      if (!jp) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}: no matching maintenance plan`)
        continue
      }

      // Derive a sensible asset_type default when creating new assets inline.
      // Use the canonical job-plan code (alias target if aliased, else raw),
      // falling back to the plan name if somehow empty. Users can edit later.
      const assetTypeDefault =
        aliasMap.get(g.jobPlanCode)?.code ?? g.jobPlanCode ?? jp.name ?? 'Equipment'

      const assetIdByRow = new Map<number, string>()
      const skippedRowNumbers = new Set<number>()
      const unmatchedWithoutResolution: number[] = []

      for (const r of g.rows) {
        const match = assetByKey.get(`${site.id}|${r.maximoAssetId}`)
        if (match) {
          assetIdByRow.set(r.rowNumber, match.id)
          continue
        }

        // No match — check per-row resolution.
        const rowKey = `${g.key}:${r.rowNumber}`
        const rr = rowResolutions[rowKey]
        if (!rr) {
          unmatchedWithoutResolution.push(r.rowNumber)
          continue
        }

        if (rr.action === 'skip') {
          skippedRowNumbers.add(r.rowNumber)
          rowsSkipped++
          continue
        }

        if (rr.action === 'link') {
          // Validate the nominated asset belongs to this tenant + site and is active.
          const { data: linked, error: linkErr } = await supabase
            .from('assets')
            .select('id, name, site_id, is_active')
            .eq('id', rr.assetId)
            .eq('tenant_id', tenantId)
            .eq('site_id', site.id)
            .eq('is_active', true)
            .maybeSingle()
          if (linkErr || !linked) {
            return {
              success: false,
              error: `Row ${r.rowNumber} (${g.siteCode}/${g.jobPlanCode}): nominated asset not found or not at site "${g.siteCode}".`,
            }
          }
          assetIdByRow.set(r.rowNumber, linked.id)
          rowsLinked++
          continue
        }

        if (rr.action === 'create') {
          // Insert a new asset with row-derived defaults. No inline edits
          // from the UI — user confirmed "simple is best" on defaults.
          const name = r.description?.trim() || r.maximoAssetId
          const { data: created, error: createErr } = await supabase
            .from('assets')
            .insert({
              tenant_id: tenantId,
              site_id: site.id,
              name,
              asset_type: assetTypeDefault,
              maximo_id: r.maximoAssetId,
              location: r.location?.trim() || null,
              job_plan_id: jp.id,
              is_active: true,
            })
            .select('id')
            .single()
          if (createErr || !created) {
            return {
              success: false,
              error: `Row ${r.rowNumber} (${g.siteCode}/${g.jobPlanCode}): failed to create asset — ${createErr?.message ?? 'insert failed'}.`,
            }
          }
          assetIdByRow.set(r.rowNumber, created.id)
          // Keep local lookups coherent in case a later row reuses this maximo_id.
          assetByKey.set(`${site.id}|${r.maximoAssetId}`, { id: created.id, name })
          rowsCreated++
          continue
        }
      }

      if (unmatchedWithoutResolution.length > 0) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: ${unmatchedWithoutResolution.length} unresolved asset row(s) — choose Link / Create / Skip for each`,
        )
        continue
      }

      // Duplicate WO check — only count rows we're actually importing.
      const dupInGroup = g.rows.filter(
        (r) => !skippedRowNumbers.has(r.rowNumber) && existingWO.has(r.workOrder),
      ).length
      if (dupInGroup > 0) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: ${dupInGroup} duplicate work order(s)`,
        )
        continue
      }

      resolved.push({
        parsed: g,
        siteId: site.id,
        siteName: site.name,
        jobPlanId: jp.id,
        jobPlanName: jp.name,
        frequency: g.frequency,
        assetIdByRow,
        skippedRowNumbers,
      })
    }

    if (blockers.length > 0) {
      return {
        success: false,
        error: `Cannot commit — ${blockers.length} blocker(s): ${blockers.slice(0, 5).join('; ')}${blockers.length > 5 ? '…' : ''}`,
      }
    }

    // ── Preload job_plan_items for every distinct (jpId, frequency) ───
    const uniquePairs = new Set<string>()
    const pairs: { jpId: string; frequency: FrequencyEnum; col: string }[] = []
    for (const g of resolved) {
      const key = `${g.jobPlanId}|${g.frequency}`
      if (uniquePairs.has(key)) continue
      uniquePairs.add(key)
      pairs.push({
        jpId: g.jobPlanId,
        frequency: g.frequency,
        col: freqColumn(g.frequency),
      })
    }

    /**
     * items lookup: `${jobPlanId}|${frequency}` → items[]
     * Queried per distinct frequency since the freq flag is a column, not a
     * value. In the August fixture there are 3 distinct frequencies so at
     * most 3 queries.
     */
    const itemsByGroup = new Map<string, {
      id: string
      description: string
      sort_order: number
      is_required: boolean
    }[]>()

    const distinctCols = Array.from(new Set(pairs.map((p) => p.col)))
    for (const col of distinctCols) {
      const jpIdsForCol = Array.from(
        new Set(pairs.filter((p) => p.col === col).map((p) => p.jpId)),
      )
      if (jpIdsForCol.length === 0) continue
      const { data: items } = await supabase
        .from('job_plan_items')
        .select('id, job_plan_id, description, sort_order, is_required')
        .in('job_plan_id', jpIdsForCol)
        .eq(col, true)
        .order('sort_order')

      for (const item of items ?? []) {
        for (const p of pairs.filter((p) => p.col === col && p.jpId === item.job_plan_id)) {
          const key = `${p.jpId}|${p.frequency}`
          const arr = itemsByGroup.get(key) ?? []
          arr.push({
            id: item.id,
            description: item.description,
            sort_order: item.sort_order,
            is_required: item.is_required,
          })
          itemsByGroup.set(key, arr)
        }
      }
    }

    // ── Write: per group, insert check + check_assets + check_items ──
    const summary: CommitSummary = {
      checksCreated: 0,
      checkAssetsCreated: 0,
      checkItemsCreated: 0,
      rowsLinked,
      rowsCreated,
      rowsSkipped,
      groupsCreated: [],
    }

    for (const g of resolved) {
      // If the user skipped every row in the group, don't create a check at all.
      if (g.skippedRowNumbers.size === g.parsed.rows.length) {
        continue
      }

      const startIso = g.parsed.startDate.toISOString().slice(0, 10)
      const monthName = g.parsed.startDate.toLocaleString('en-AU', { month: 'long' })
      const year = g.parsed.startDate.getFullYear()
      const customName = `${g.siteName} — ${g.jobPlanName} — ${monthName} ${year}`

      // 1. maintenance_checks
      const { data: check, error: checkErr } = await supabase
        .from('maintenance_checks')
        .insert({
          tenant_id: tenantId,
          site_id: g.siteId,
          job_plan_id: g.jobPlanId,
          frequency: g.frequency,
          start_date: startIso,
          due_date: startIso,
          custom_name: customName,
          status: 'scheduled',
          assigned_to: assignedTo,
        })
        .select('id')
        .single()

      if (checkErr || !check) {
        return { success: false, error: checkErr?.message ?? 'Failed to create check.' }
      }

      // The three-step insert below (check → check_assets → check_items)
      // cannot run inside a single Postgres transaction via the Supabase JS
      // client — each call is its own HTTP roundtrip to PostgREST. If a
      // later step fails after the parent check is in, the user is left
      // with an orphaned `maintenance_checks` row pointing at no work.
      //
      // Compensating delete: on any downstream failure, DELETE the parent
      // check. The FK from `check_assets.check_id` is ON DELETE CASCADE
      // (migration 0013) so the partial `check_assets` rows are removed
      // automatically; `maintenance_check_items` cascades from there.
      // The result is the same end state as a real transaction: either
      // every row for this group lands, or none of them do.
      const rollbackCheck = async (reason: string): Promise<string> => {
        await supabase.from('maintenance_checks').delete().eq('id', check.id)
        return reason
      }

      // 2. check_assets (one per parsed row) — carries the full Maximo
      // payload from the parsed Delta row (priority, work_type, crew,
      // target dates, failure/problem/cause/remedy, classification, IR
      // scan result) so the customer report + asset history can read it
      // back. Skipped rows are excluded — no check_asset, no check_items.
      const checkAssetRows = g.parsed.rows
        .filter((r) => !g.skippedRowNumbers.has(r.rowNumber))
        .map((r) =>
          deltaRowToCheckAssetInsert(r, {
            tenantId,
            checkId: check.id,
            assetId: g.assetIdByRow.get(r.rowNumber)!,
          }),
        )

      const { data: insertedCA, error: caErr } = await supabase
        .from('check_assets')
        .insert(checkAssetRows)
        .select('id, asset_id')

      if (caErr || !insertedCA) {
        const reason = await rollbackCheck(caErr?.message ?? 'Failed to create check assets.')
        return { success: false, error: reason }
      }

      const caByAsset = new Map<string, string>()
      for (const ca of insertedCA) caByAsset.set(ca.asset_id, ca.id)

      // 3. maintenance_check_items (one per asset × matching job_plan_item)
      const items = itemsByGroup.get(`${g.jobPlanId}|${g.frequency}`) ?? []
      const checkItemRows: {
        tenant_id: string
        check_id: string
        check_asset_id: string
        job_plan_item_id: string
        asset_id: string
        description: string
        sort_order: number
        is_required: boolean
      }[] = []

      for (const [assetId, caId] of caByAsset) {
        for (const it of items) {
          checkItemRows.push({
            tenant_id: tenantId,
            check_id: check.id,
            check_asset_id: caId,
            job_plan_item_id: it.id,
            asset_id: assetId,
            description: it.description,
            sort_order: it.sort_order,
            is_required: it.is_required,
          })
        }
      }

      if (checkItemRows.length > 0) {
        for (let i = 0; i < checkItemRows.length; i += 500) {
          const batch = checkItemRows.slice(i, i + 500)
          const { error: itemsErr } = await supabase
            .from('maintenance_check_items')
            .insert(batch)
          if (itemsErr) {
            const reason = await rollbackCheck(itemsErr.message)
            return { success: false, error: reason }
          }
        }
      }

      summary.checksCreated += 1
      summary.checkAssetsCreated += insertedCA.length
      summary.checkItemsCreated += checkItemRows.length
      summary.groupsCreated.push({
        key: g.parsed.key,
        checkId: check.id,
        customName,
        siteCode: g.parsed.siteCode,
        jobPlanCode: g.parsed.jobPlanCode,
        frequency: g.frequency,
        startDate: startIso,
        assetCount: insertedCA.length,
        taskCount: checkItemRows.length,
      })
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Delta import: created ${summary.checksCreated} checks, ${summary.checkAssetsCreated} assets, ${summary.checkItemsCreated} tasks`,
      metadata: {
        source: 'delta_wo_import',
        filename: file.name,
        checksCreated: summary.checksCreated,
        groupsSkipped: skippedKeys.size,
        aliasesCreated: aliasesCreated.length,
        plansCreated: plansCreated.length,
        rowsLinked: summary.rowsLinked,
        rowsCreated: summary.rowsCreated,
        rowsSkipped: summary.rowsSkipped,
      },
      mutationId,
    })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true, data: summary }
  })
}

// ───────────────────────────────────────────────────────────────────────
// Consolidated multi-file commit (Phase 2 of multi-file import)
//
// Takes N .xlsx files for the SAME site and writes a SINGLE
// maintenance_check covering all their work orders. The check has
// `job_plan_id = NULL` (it spans multiple plans); each asset still
// gets check_items derived from its own underlying maintenance plan.
//
// Locked decisions (2026-04-27 with Royce):
//   - frequency: most common across resolved groups; ties → earliest
//   - same WO across files: hard error (Maximo WOs are unique by design)
//   - different sites across files: hard error (consolidate is per-site)
// ───────────────────────────────────────────────────────────────────────

export async function commitConsolidatedDeltaImportAction(
  formData: FormData,
  mutationId?: string,
): Promise<CommitActionResult> {
  return withIdempotency<CommitSummary>(mutationId, async () => {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    // ── Read files (file_0, file_1, ...) ──────────────────────────────
    const files: File[] = []
    let i = 0
    while (true) {
      const f = formData.get(`file_${i}`)
      if (!(f instanceof File)) break
      files.push(f)
      i++
    }
    if (files.length === 0) {
      return { success: false, error: 'No files uploaded.' }
    }

    // Custom name for the consolidated check (user-supplied, required).
    const customNameRaw = formData.get('customName')
    const customName =
      typeof customNameRaw === 'string' && customNameRaw.trim().length > 0
        ? customNameRaw.trim()
        : null
    if (!customName) {
      return { success: false, error: 'Consolidated check name is required.' }
    }

    const assignedToRaw = formData.get('assigned_to')
    const assignedTo =
      typeof assignedToRaw === 'string' && assignedToRaw.trim().length > 0
        ? assignedToRaw.trim()
        : null

    // Resolutions and rowResolutions are combined across files.
    let resolutions: Record<string, GroupResolution> = {}
    const resolutionsRaw = formData.get('resolutions')
    if (typeof resolutionsRaw === 'string' && resolutionsRaw.trim().length > 0) {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(resolutionsRaw)
      } catch {
        return { success: false, error: 'Invalid resolutions payload — expected JSON.' }
      }
      const parsed = ResolutionsMapSchema.safeParse(parsedJson)
      if (!parsed.success) {
        return { success: false, error: `Invalid resolution: ${parsed.error.issues[0]?.message ?? 'bad payload'}` }
      }
      resolutions = parsed.data
    }
    let rowResolutions: Record<string, RowResolution> = {}
    const rrRaw = formData.get('rowResolutions')
    if (typeof rrRaw === 'string' && rrRaw.trim().length > 0) {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rrRaw)
      } catch {
        return { success: false, error: 'Invalid rowResolutions payload — expected JSON.' }
      }
      const parsed = RowResolutionsMapSchema.safeParse(parsedJson)
      if (!parsed.success) {
        return { success: false, error: `Invalid row resolution: ${parsed.error.issues[0]?.message ?? 'bad payload'}` }
      }
      rowResolutions = parsed.data
    }

    // ── Parse all files; combine rows/groups + dedup WO across files ─
    const allRows: DeltaRow[] = []
    const allGroupsRaw: ParsedGroup[] = []
    const allErrors: { rowNumber: number; message: string }[] = []
    const woToFiles = new Map<string, string[]>()

    for (const f of files) {
      const buf = Buffer.from(await f.arrayBuffer())
      const parsed = await parseWorkbook(buf)
      for (const r of parsed.rows) {
        allRows.push(r)
        const list = woToFiles.get(r.workOrder) ?? []
        list.push(f.name)
        woToFiles.set(r.workOrder, list)
      }
      for (const g of parsed.groups) allGroupsRaw.push(g)
      for (const e of parsed.errors) allErrors.push(e)
    }

    if (allErrors.length > 0) {
      return {
        success: false,
        error: `Parse produced ${allErrors.length} error(s). Fix the sheets and retry.`,
      }
    }
    if (allRows.length === 0 || allGroupsRaw.length === 0) {
      return { success: false, error: 'No importable rows found across any uploaded workbook.' }
    }

    // Cross-file WO dedup — locked decision: hard error.
    const dupes: { wo: string; files: string[] }[] = []
    for (const [wo, fileList] of woToFiles) {
      if (fileList.length > 1) {
        dupes.push({ wo, files: Array.from(new Set(fileList)) })
      }
    }
    if (dupes.length > 0) {
      const sample = dupes
        .slice(0, 5)
        .map((d) => `${d.wo} (in ${d.files.join(', ')})`)
        .join('; ')
      const more = dupes.length > 5 ? ` (+${dupes.length - 5} more)` : ''
      return {
        success: false,
        error: `Cannot consolidate — ${dupes.length} work order(s) appear in multiple files: ${sample}${more}. Maximo WOs are unique by design; check the source exports.`,
      }
    }

    // Same-site validation — consolidate requires all files target one site.
    const distinctSites = new Set(allRows.map((r) => r.siteCode))
    if (distinctSites.size > 1) {
      return {
        success: false,
        error: `Cannot consolidate across multiple sites: ${Array.from(distinctSites).join(', ')}. Upload files for one site at a time, or commit as separate checks.`,
      }
    }

    // ── Resolve sites (single site, but reuse the existing pattern) ──
    const siteCodes = Array.from(distinctSites)
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('code', siteCodes)
    const siteByCode = new Map<string, { id: string; name: string }>()
    for (const s of siteRows ?? []) {
      if (s.code) siteByCode.set(s.code, { id: s.id, name: s.name })
    }

    // ── Resolve maintenance plans (active codes for tenant) ──────────────────
    const { data: jpRows } = await supabase
      .from('job_plans')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .not('code', 'is', null)
    const jpByCode = new Map<string, { id: string; name: string }>()
    for (const jp of jpRows ?? []) {
      if (jp.code) jpByCode.set(jp.code, { id: jp.id, name: jp.name })
    }

    // ── Load delta aliases ────────────────────────────────────────────
    const { data: aliasRows } = await supabase
      .from('job_plan_aliases')
      .select('external_code, job_plan_id')
      .eq('tenant_id', tenantId)
      .eq('source_system', 'delta')
    const aliasMap = new Map<string, { id: string; code: string; name: string }>()
    if (aliasRows && aliasRows.length > 0) {
      const aliasIds = Array.from(
        new Set(aliasRows.map((a) => a.job_plan_id).filter(Boolean)),
      ) as string[]
      if (aliasIds.length > 0) {
        const { data: aliasTargets } = await supabase
          .from('job_plans')
          .select('id, code, name')
          .in('id', aliasIds)
        const byId = new Map<string, { id: string; code: string; name: string }>()
        for (const t of aliasTargets ?? []) {
          if (t.code) byId.set(t.id, { id: t.id, code: t.code, name: t.name })
        }
        for (const a of aliasRows) {
          const target = byId.get(a.job_plan_id)
          if (target) aliasMap.set(a.external_code, target)
        }
      }
    }

    // ── Apply user resolutions (mirrors single-file commit) ──────────
    const skippedKeys = new Set<string>()
    const aliasesCreated: { externalCode: string; jobPlanId: string }[] = []
    const plansCreated: { id: string; code: string; name: string }[] = []
    const jpByLowerCode = new Map<string, string>()
    for (const [k, v] of jpByCode) jpByLowerCode.set(k.toLowerCase(), v.id)

    for (const g of allGroupsRaw) {
      const resolution = resolutions[g.key]
      if (!resolution) continue
      if (resolution.action === 'skip') {
        skippedKeys.add(g.key)
        continue
      }
      const alreadyResolved = jpByCode.has(g.jobPlanCode) || aliasMap.has(g.jobPlanCode)
      if (alreadyResolved && resolution.action !== 'create') continue

      let targetJobPlanId: string | null = null
      let targetCode: string | null = null
      let targetName: string | null = null

      if (resolution.action === 'accept') {
        const near = closestMatch(g.jobPlanCode, Array.from(jpByCode.keys()), 2)
        if (!near) {
          return { success: false, error: `Cannot accept fuzzy match for "${g.jobPlanCode}" — no close candidate found.` }
        }
        const jp = jpByCode.get(near.value)
        if (!jp) {
          return { success: false, error: `Fuzzy candidate "${near.value}" no longer exists — re-preview the import.` }
        }
        targetJobPlanId = jp.id; targetCode = near.value; targetName = jp.name
      } else if (resolution.action === 'nominate') {
        const { data: plan, error: planErr } = await supabase
          .from('job_plans')
          .select('id, code, name')
          .eq('id', resolution.jobPlanId)
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .maybeSingle()
        if (planErr || !plan) {
          return { success: false, error: `Nominated maintenance plan not found or inactive (group ${g.siteCode}/${g.jobPlanCode}).` }
        }
        targetJobPlanId = plan.id; targetCode = plan.code ?? g.jobPlanCode; targetName = plan.name
      } else if (resolution.action === 'create') {
        const lower = resolution.code.trim().toLowerCase()
        const existingId = jpByLowerCode.get(lower)
        if (existingId) {
          return { success: false, error: `Cannot create plan "${resolution.code}" — a plan with that code already exists. Use "Nominate existing" instead.` }
        }
        const { data: newPlan, error: createErr } = await supabase
          .from('job_plans')
          .insert({
            tenant_id: tenantId,
            site_id: null,
            name: resolution.name.trim(),
            code: resolution.code.trim(),
            type: resolution.type?.trim() || null,
            is_active: true,
          })
          .select('id, code, name')
          .single()
        if (createErr || !newPlan) {
          return { success: false, error: createErr?.message ?? 'Failed to create maintenance plan.' }
        }
        const newCode: string = newPlan.code ?? resolution.code.trim()
        targetJobPlanId = newPlan.id; targetCode = newCode; targetName = newPlan.name
        plansCreated.push({ id: newPlan.id, code: newCode, name: newPlan.name })
        jpByCode.set(newCode, { id: newPlan.id, name: newPlan.name })
        jpByLowerCode.set(lower, newPlan.id)
      }

      if (!targetJobPlanId || !targetCode || !targetName) {
        return { success: false, error: `Could not resolve target plan for group ${g.siteCode}/${g.jobPlanCode}.` }
      }

      const { error: aliasErr } = await supabase
        .from('job_plan_aliases')
        .upsert(
          {
            tenant_id: tenantId,
            source_system: 'delta',
            external_code: g.jobPlanCode,
            job_plan_id: targetJobPlanId,
            created_by: user.id,
          },
          { onConflict: 'tenant_id,source_system,external_code' },
        )
      if (aliasErr) {
        return { success: false, error: `Failed to create alias: ${aliasErr.message}` }
      }
      aliasMap.set(g.jobPlanCode, { id: targetJobPlanId, code: targetCode, name: targetName })
      aliasesCreated.push({ externalCode: g.jobPlanCode, jobPlanId: targetJobPlanId })
    }

    const workingGroups = allGroupsRaw.filter((g) => !skippedKeys.has(g.key))
    if (workingGroups.length === 0) {
      return { success: false, error: 'No groups selected — every group was skipped.' }
    }

    // ── Resolve assets + WO duplicate check vs DB ────────────────────
    const workingRows = workingGroups.flatMap((g) => g.rows)
    const resolvedSiteIds = Array.from(siteByCode.values()).map((s) => s.id)
    const maximoIds = Array.from(new Set(workingRows.map((r) => r.maximoAssetId)))
    const assetByKey = new Map<string, { id: string; name: string }>()
    if (resolvedSiteIds.length > 0 && maximoIds.length > 0) {
      const { data: assetRows } = await supabase
        .from('assets')
        .select('id, name, site_id, maximo_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('site_id', resolvedSiteIds)
        .in('maximo_id', maximoIds)
      for (const a of assetRows ?? []) {
        if (a.maximo_id) assetByKey.set(`${a.site_id}|${a.maximo_id}`, { id: a.id, name: a.name })
      }
    }

    const incomingWOs = Array.from(new Set(workingRows.map((r) => r.workOrder)))
    const existingWO = new Set<string>()
    if (incomingWOs.length > 0) {
      const { data: dupRows } = await supabase
        .from('check_assets')
        .select('work_order_number')
        .eq('tenant_id', tenantId)
        .in('work_order_number', incomingWOs)
      for (const d of dupRows ?? []) {
        if (d.work_order_number) existingWO.add(d.work_order_number)
      }
    }

    // ── Validate every working group ──────────────────────────────────
    interface ResolvedGroup {
      parsed: ParsedGroup
      siteId: string
      siteName: string
      jobPlanId: string
      jobPlanName: string
      frequency: FrequencyEnum
      assetIdByRow: Map<number, string>
      skippedRowNumbers: Set<number>
    }

    const resolved: ResolvedGroup[] = []
    const blockers: string[] = []
    let rowsLinked = 0
    let rowsCreated = 0
    let rowsSkipped = 0

    for (const g of workingGroups) {
      const site = siteByCode.get(g.siteCode)
      if (!site) { blockers.push(`Site "${g.siteCode}" not found`); continue }
      if (!g.frequency) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}/${g.frequencySuffix}: unknown frequency`)
        continue
      }
      let jp = jpByCode.get(g.jobPlanCode) ?? null
      if (!jp) {
        const alias = aliasMap.get(g.jobPlanCode)
        if (alias) jp = { id: alias.id, name: alias.name }
      }
      if (!jp) { blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}: no matching maintenance plan`); continue }

      const assetTypeDefault = aliasMap.get(g.jobPlanCode)?.code ?? g.jobPlanCode ?? jp.name ?? 'Equipment'
      const assetIdByRow = new Map<number, string>()
      const skippedRowNumbers = new Set<number>()
      const unmatchedNoRes: number[] = []

      for (const r of g.rows) {
        const match = assetByKey.get(`${site.id}|${r.maximoAssetId}`)
        if (match) { assetIdByRow.set(r.rowNumber, match.id); continue }
        const rowKey = `${g.key}:${r.rowNumber}`
        const rr = rowResolutions[rowKey]
        if (!rr) { unmatchedNoRes.push(r.rowNumber); continue }

        if (rr.action === 'skip') {
          skippedRowNumbers.add(r.rowNumber); rowsSkipped++; continue
        }

        if (rr.action === 'link') {
          const { data: linked, error: linkErr } = await supabase
            .from('assets')
            .select('id, name, site_id, is_active')
            .eq('id', rr.assetId)
            .eq('tenant_id', tenantId)
            .eq('site_id', site.id)
            .eq('is_active', true)
            .maybeSingle()
          if (linkErr || !linked) {
            return { success: false, error: `Row ${r.rowNumber} (${g.siteCode}/${g.jobPlanCode}): nominated asset not found or not at site "${g.siteCode}".` }
          }
          assetIdByRow.set(r.rowNumber, linked.id); rowsLinked++; continue
        }

        if (rr.action === 'create') {
          const name = r.description?.trim() || r.maximoAssetId
          const { data: created, error: createErr } = await supabase
            .from('assets')
            .insert({
              tenant_id: tenantId, site_id: site.id, name,
              asset_type: assetTypeDefault, maximo_id: r.maximoAssetId,
              location: r.location?.trim() || null, job_plan_id: jp.id, is_active: true,
            })
            .select('id')
            .single()
          if (createErr || !created) {
            return { success: false, error: `Row ${r.rowNumber} (${g.siteCode}/${g.jobPlanCode}): failed to create asset — ${createErr?.message ?? 'insert failed'}.` }
          }
          assetIdByRow.set(r.rowNumber, created.id)
          assetByKey.set(`${site.id}|${r.maximoAssetId}`, { id: created.id, name })
          rowsCreated++; continue
        }
      }

      if (unmatchedNoRes.length > 0) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}: ${unmatchedNoRes.length} unresolved asset row(s) — choose Link / Create / Skip for each`)
        continue
      }
      const dupInGroup = g.rows.filter(
        (r) => !skippedRowNumbers.has(r.rowNumber) && existingWO.has(r.workOrder),
      ).length
      if (dupInGroup > 0) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}: ${dupInGroup} duplicate work order(s) already imported`)
        continue
      }
      resolved.push({
        parsed: g, siteId: site.id, siteName: site.name,
        jobPlanId: jp.id, jobPlanName: jp.name, frequency: g.frequency,
        assetIdByRow, skippedRowNumbers,
      })
    }

    if (blockers.length > 0) {
      return {
        success: false,
        error: `Cannot commit — ${blockers.length} blocker(s): ${blockers.slice(0, 5).join('; ')}${blockers.length > 5 ? '…' : ''}`,
      }
    }

    // ── Compute consolidated frequency: most common across resolved ──
    // Locked decision 2026-04-27: most common wins; ties → earliest start.
    const freqInfo = new Map<FrequencyEnum, { count: number; earliest: Date }>()
    for (const g of resolved) {
      const cur = freqInfo.get(g.frequency)
      if (!cur) {
        freqInfo.set(g.frequency, { count: 1, earliest: g.parsed.startDate })
      } else {
        cur.count += 1
        if (g.parsed.startDate < cur.earliest) cur.earliest = g.parsed.startDate
        freqInfo.set(g.frequency, cur)
      }
    }
    let consolidatedFrequency: FrequencyEnum = resolved[0].frequency
    let bestCount = 0
    let bestEarliest = new Date(8640000000000000)
    for (const [freq, info] of freqInfo) {
      if (info.count > bestCount || (info.count === bestCount && info.earliest < bestEarliest)) {
        consolidatedFrequency = freq
        bestCount = info.count
        bestEarliest = info.earliest
      }
    }

    // Earliest start across all resolved → consolidated start_date / due_date.
    let earliestStart: Date = resolved[0].parsed.startDate
    for (const g of resolved) {
      if (g.parsed.startDate < earliestStart) earliestStart = g.parsed.startDate
    }
    const startIso = earliestStart.toISOString().slice(0, 10)

    // ── Preload job_plan_items per (jpId, frequency) ──────────────────
    const uniquePairs = new Set<string>()
    const pairs: { jpId: string; frequency: FrequencyEnum; col: string }[] = []
    for (const g of resolved) {
      const key = `${g.jobPlanId}|${g.frequency}`
      if (uniquePairs.has(key)) continue
      uniquePairs.add(key)
      pairs.push({ jpId: g.jobPlanId, frequency: g.frequency, col: freqColumn(g.frequency) })
    }
    const itemsByGroup = new Map<string, { id: string; description: string; sort_order: number; is_required: boolean }[]>()
    const distinctCols = Array.from(new Set(pairs.map((p) => p.col)))
    for (const col of distinctCols) {
      const jpIdsForCol = Array.from(new Set(pairs.filter((p) => p.col === col).map((p) => p.jpId)))
      if (jpIdsForCol.length === 0) continue
      const { data: items } = await supabase
        .from('job_plan_items')
        .select('id, job_plan_id, description, sort_order, is_required')
        .in('job_plan_id', jpIdsForCol)
        .eq(col, true)
        .order('sort_order')
      for (const item of items ?? []) {
        for (const p of pairs.filter((p) => p.col === col && p.jpId === item.job_plan_id)) {
          const key = `${p.jpId}|${p.frequency}`
          const arr = itemsByGroup.get(key) ?? []
          arr.push({
            id: item.id, description: item.description,
            sort_order: item.sort_order, is_required: item.is_required,
          })
          itemsByGroup.set(key, arr)
        }
      }
    }

    // ── Write: ONE consolidated check + check_assets across all groups ─
    const summary: CommitSummary = {
      checksCreated: 0,
      checkAssetsCreated: 0,
      checkItemsCreated: 0,
      rowsLinked, rowsCreated, rowsSkipped,
      groupsCreated: [],
    }

    const totalToInsert = resolved.reduce(
      (acc, g) => acc + (g.parsed.rows.length - g.skippedRowNumbers.size),
      0,
    )
    if (totalToInsert === 0) {
      return { success: false, error: 'No rows to insert — every row was skipped.' }
    }

    const consolidatedSite = resolved[0]
    const { data: check, error: checkErr } = await supabase
      .from('maintenance_checks')
      .insert({
        tenant_id: tenantId,
        site_id: consolidatedSite.siteId,
        job_plan_id: null,
        frequency: consolidatedFrequency,
        start_date: startIso,
        due_date: startIso,
        custom_name: customName,
        status: 'scheduled',
        assigned_to: assignedTo,
      })
      .select('id')
      .single()
    if (checkErr || !check) {
      return { success: false, error: checkErr?.message ?? 'Failed to create consolidated check.' }
    }
    summary.checksCreated = 1

    // Compensating delete on downstream failure — same pattern as the
    // single-file commit above. ON DELETE CASCADE on the FK to
    // maintenance_checks removes any partial check_assets /
    // maintenance_check_items so the parent never ends up with no
    // children.
    const rollbackCheck = async (reason: string): Promise<string> => {
      await supabase.from('maintenance_checks').delete().eq('id', check.id)
      return reason
    }

    const allCARows = resolved.flatMap((g) =>
      g.parsed.rows
        .filter((r) => !g.skippedRowNumbers.has(r.rowNumber))
        .map((r) =>
          deltaRowToCheckAssetInsert(r, {
            tenantId,
            checkId: check.id,
            assetId: g.assetIdByRow.get(r.rowNumber)!,
          }),
        ),
    )
    const { data: insertedCA, error: caErr } = await supabase
      .from('check_assets')
      .insert(allCARows)
      .select('id, asset_id')
    if (caErr || !insertedCA) {
      const reason = await rollbackCheck(caErr?.message ?? 'Failed to create check assets.')
      return { success: false, error: reason }
    }
    summary.checkAssetsCreated = insertedCA.length
    const caByAsset = new Map<string, string>()
    for (const ca of insertedCA) caByAsset.set(ca.asset_id, ca.id)

    const checkItemRows: {
      tenant_id: string; check_id: string; check_asset_id: string;
      job_plan_item_id: string; asset_id: string; description: string;
      sort_order: number; is_required: boolean;
    }[] = []
    for (const g of resolved) {
      const items = itemsByGroup.get(`${g.jobPlanId}|${g.frequency}`) ?? []
      for (const r of g.parsed.rows) {
        if (g.skippedRowNumbers.has(r.rowNumber)) continue
        const assetId = g.assetIdByRow.get(r.rowNumber)
        if (!assetId) continue
        const caId = caByAsset.get(assetId)
        if (!caId) continue
        for (const it of items) {
          checkItemRows.push({
            tenant_id: tenantId, check_id: check.id, check_asset_id: caId,
            job_plan_item_id: it.id, asset_id: assetId,
            description: it.description, sort_order: it.sort_order, is_required: it.is_required,
          })
        }
      }
    }
    if (checkItemRows.length > 0) {
      for (let i = 0; i < checkItemRows.length; i += 500) {
        const batch = checkItemRows.slice(i, i + 500)
        const { error: itemsErr } = await supabase
          .from('maintenance_check_items')
          .insert(batch)
        if (itemsErr) {
          const reason = await rollbackCheck(itemsErr.message)
          return { success: false, error: reason }
        }
      }
    }
    summary.checkItemsCreated = checkItemRows.length

    summary.groupsCreated.push({
      key: `consolidated:${check.id}`,
      checkId: check.id,
      customName,
      siteCode: consolidatedSite.parsed.siteCode,
      jobPlanCode: 'consolidated',
      frequency: consolidatedFrequency,
      startDate: startIso,
      assetCount: summary.checkAssetsCreated,
      taskCount: summary.checkItemsCreated,
    })

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Delta consolidated import: 1 check, ${summary.checkAssetsCreated} assets, ${summary.checkItemsCreated} tasks across ${files.length} file(s)`,
      metadata: {
        source: 'delta_wo_import_consolidated',
        consolidatedCheckId: check.id,
        consolidatedFrequency,
        fileCount: files.length,
        filenames: files.map((f) => f.name),
        groupsCount: resolved.length,
        skippedKeys: skippedKeys.size,
        aliasesCreated: aliasesCreated.length,
        plansCreated: plansCreated.length,
        rowsLinked: summary.rowsLinked,
        rowsCreated: summary.rowsCreated,
        rowsSkipped: summary.rowsSkipped,
      },
      mutationId,
    })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true, data: summary }
  })
}
