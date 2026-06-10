'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency, type ActionResult } from '@/lib/actions/idempotency'
import { parseJemenaRcdWorkbook } from '@/lib/import/jemena-rcd-parser'

// ── Types ───────────────────────────────────────────────────────────

export interface RcdImportPreviewBoard {
  tabName: string
  boardName: string
  siteLabel: string
  resolvedSiteId: string | null
  resolvedSiteName: string | null
  resolvedAssetId: string | null
  resolvedAssetName: string | null
  testDate: string | null
  technicianName: string
  circuitCount: number
  duplicate: boolean
  warnings: string[]
}

export interface RcdImportPreviewResult {
  success: true
  filename: string
  boardCount: number
  totalCircuits: number
  boards: RcdImportPreviewBoard[]
  parseErrors: { tabName: string; rowNumber: number; message: string }[]
  skippedSheets: { tabName: string; reason: string }[]
}

export type RcdImportPreviewActionResult =
  | RcdImportPreviewResult
  | { success: false; error: string }

export interface RcdImportCommitSummary {
  testsCreated: number
  circuitsCreated: number
  boardsSkipped: number
  checksCreated: number
  filename: string
}

export type RcdImportCommitActionResult = ActionResult<RcdImportCommitSummary>

// ── Preview ─────────────────────────────────────────────────────────

export async function previewJemenaRcdImportAction(
  formData: FormData,
): Promise<RcdImportPreviewActionResult> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }
    const filename = file.name || 'rcd-import.xlsx'

    const buf = Buffer.from(await file.arrayBuffer())
    const parsed = await parseJemenaRcdWorkbook(buf)

    if (parsed.tests.length === 0) {
      return {
        success: true,
        filename,
        boardCount: 0,
        totalCircuits: 0,
        boards: [],
        parseErrors: parsed.errors,
        skippedSheets: parsed.skippedSheets,
      }
    }

    // Site lookup. Match parsed siteLabel ("Jemena Cardiff") to sites.name
    // ("Cardiff") by stripping the "Jemena " prefix where present.
    const candidateNames = new Set<string>()
    for (const t of parsed.tests) {
      candidateNames.add(t.siteLabel)
      const stripped = t.siteLabel.replace(/^jemena\s+/i, '').trim()
      if (stripped) candidateNames.add(stripped)
    }
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('name', Array.from(candidateNames))

    const siteByName = new Map<string, { id: string; name: string }>()
    for (const s of siteRows ?? []) {
      siteByName.set(s.name.toLowerCase(), { id: s.id, name: s.name })
    }
    function resolveSite(siteLabel: string) {
      const stripped = siteLabel.replace(/^jemena\s+/i, '').trim().toLowerCase()
      return siteByName.get(stripped) ?? siteByName.get(siteLabel.toLowerCase()) ?? null
    }

    // Asset lookup — prefetch all candidate assets across resolved sites.
    const resolvedSiteIds = new Set<string>()
    for (const t of parsed.tests) {
      const s = resolveSite(t.siteLabel)
      if (s) resolvedSiteIds.add(s.id)
    }
    const { data: assetRows } = resolvedSiteIds.size > 0
      ? await supabase
          .from('assets')
          .select('id, name, site_id')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .in('site_id', Array.from(resolvedSiteIds))
      : { data: [] }

    const assetBySiteName = new Map<string, { id: string; name: string }>()
    for (const a of assetRows ?? []) {
      assetBySiteName.set(`${a.site_id}|${a.name.toLowerCase()}`, { id: a.id, name: a.name })
    }
    function resolveAsset(siteId: string, boardName: string) {
      const candidates = [boardName, normaliseBoardName(boardName)]
      for (const c of candidates) {
        const hit = assetBySiteName.get(`${siteId}|${c.toLowerCase()}`)
        if (hit) return hit
      }
      return null
    }

    // Duplicate check against existing rcd_tests.
    const isoDates = Array.from(
      new Set(
        parsed.tests.map((t) => (t.testDate ? t.testDate.toISOString().slice(0, 10) : '')),
      ),
    ).filter(Boolean)
    const dupKeys = new Set<string>()
    if (isoDates.length > 0) {
      const { data: existing } = await supabase
        .from('rcd_tests')
        .select('asset_id, test_date')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .neq('status', 'archived')
        .in('test_date', isoDates)
      for (const e of existing ?? []) {
        dupKeys.add(`${e.asset_id}|${e.test_date}`)
      }
    }

    const boards: RcdImportPreviewBoard[] = parsed.tests.map((t) => {
      const site = resolveSite(t.siteLabel)
      const asset = site ? resolveAsset(site.id, t.boardName) : null
      const isoDate = t.testDate ? t.testDate.toISOString().slice(0, 10) : null

      const warnings: string[] = []
      if (!site) warnings.push(`Site "${t.siteLabel}" not found in EQ`)
      if (site && !asset)
        warnings.push(
          `Board "${t.boardName}" not found at site "${site.name}" — create asset first or import will skip this board`,
        )
      if (!t.testDate) warnings.push('Test date missing from sheet header')
      if (t.circuits.length === 0) warnings.push('No circuit rows parsed from this sheet')

      const duplicate = !!(asset && isoDate && dupKeys.has(`${asset.id}|${isoDate}`))
      if (duplicate)
        warnings.push(`A non-archived RCD test already exists for this board on ${isoDate}`)

      return {
        tabName: t.tabName,
        boardName: t.boardName,
        siteLabel: t.siteLabel,
        resolvedSiteId: site?.id ?? null,
        resolvedSiteName: site?.name ?? null,
        resolvedAssetId: asset?.id ?? null,
        resolvedAssetName: asset?.name ?? null,
        testDate: isoDate,
        technicianName: t.technicianName,
        circuitCount: t.circuits.length,
        duplicate,
        warnings,
      }
    })

    return {
      success: true,
      filename,
      boardCount: boards.length,
      totalCircuits: boards.reduce((acc, b) => acc + b.circuitCount, 0),
      boards,
      parseErrors: parsed.errors,
      skippedSheets: parsed.skippedSheets,
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Commit ──────────────────────────────────────────────────────────

export async function commitJemenaRcdImportAction(
  formData: FormData,
  mutationId?: string,
): Promise<RcdImportCommitActionResult> {
  return withIdempotency<RcdImportCommitSummary>(mutationId, async () => {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }
    const filename = file.name || 'rcd-import.xlsx'

    const buf = Buffer.from(await file.arrayBuffer())
    const parsed = await parseJemenaRcdWorkbook(buf)
    if (parsed.tests.length === 0) {
      return { success: false, error: 'No parseable RCD test sheets found in workbook.' }
    }
    if (parsed.errors.length > 0) {
      return {
        success: false,
        error: `Parse produced ${parsed.errors.length} error(s). Re-upload after fixing the source.`,
      }
    }

    const candidateNames = new Set<string>()
    for (const t of parsed.tests) {
      candidateNames.add(t.siteLabel)
      const stripped = t.siteLabel.replace(/^jemena\s+/i, '').trim()
      if (stripped) candidateNames.add(stripped)
    }
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, name, customer_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('name', Array.from(candidateNames))
    const siteByName = new Map<
      string,
      { id: string; name: string; customer_id: string | null }
    >()
    for (const s of siteRows ?? []) siteByName.set(s.name.toLowerCase(), s)
    function resolveSite(siteLabel: string) {
      const stripped = siteLabel.replace(/^jemena\s+/i, '').trim().toLowerCase()
      return siteByName.get(stripped) ?? siteByName.get(siteLabel.toLowerCase()) ?? null
    }

    const siteIds = new Set<string>()
    for (const t of parsed.tests) {
      const s = resolveSite(t.siteLabel)
      if (s) siteIds.add(s.id)
    }
    const { data: assetRows } = siteIds.size > 0
      ? await supabase
          .from('assets')
          .select('id, name, site_id')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .in('site_id', Array.from(siteIds))
      : { data: [] }
    const assetBySiteName = new Map<string, { id: string; name: string }>()
    for (const a of assetRows ?? []) {
      assetBySiteName.set(`${a.site_id}|${a.name.toLowerCase()}`, a)
    }
    function resolveAsset(siteId: string, boardName: string) {
      const candidates = [boardName, normaliseBoardName(boardName)]
      for (const c of candidates) {
        const hit = assetBySiteName.get(`${siteId}|${c.toLowerCase()}`)
        if (hit) return hit
      }
      return null
    }

    const isoDates = Array.from(
      new Set(
        parsed.tests.map((t) => (t.testDate ? t.testDate.toISOString().slice(0, 10) : '')),
      ),
    ).filter(Boolean)
    const dupKeys = new Set<string>()
    if (isoDates.length > 0) {
      const { data: existing } = await supabase
        .from('rcd_tests')
        .select('asset_id, test_date')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .neq('status', 'archived')
        .in('test_date', isoDates)
      for (const e of existing ?? []) {
        dupKeys.add(`${e.asset_id}|${e.test_date}`)
      }
    }

    // Load all RCD-marked maintenance plans for the tenant once. Used below to
    // find-or-create a maintenance_check that owns each rcd_tests row, so
    // the imported work surfaces in the standard /maintenance dashboard.
    const { data: allRcdPlans } = await supabase
      .from('job_plans')
      .select('id, customer_id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('code.ilike.%RCD%,name.ilike.%RCD%')

    function rcdPlanForCustomer(customerId: string | null): { id: string } | null {
      const candidates = allRcdPlans ?? []
      // Prefer a customer-scoped plan; fall back to a global plan.
      const scoped = candidates.find((p) => p.customer_id === customerId)
      if (scoped) return { id: scoped.id }
      const global = candidates.find((p) => p.customer_id === null)
      if (global) return { id: global.id }
      return null
    }

    // In-memory cache so multiple tabs that map to the same (site, plan,
    // month) share a single maintenance_check. Key: `${siteId}|${planId}|${YYYY-MM}`.
    const checkCache = new Map<string, string>()
    let checksCreated = 0

    /**
     * Find an open maintenance_check for this site + plan + month, or create
     * a fresh one. Returns the check id, or null if no RCD plan exists for
     * this customer (caller leaves rcd_tests.check_id null).
     *
     * Frequency rule: May visits cover the annual time-trip + biannual push-
     * button items; other months are push-button only.
     */
    async function findOrCreateRcdCheck(
      siteId: string,
      customerId: string | null,
      isoTestDate: string,
    ): Promise<string | null> {
      const plan = rcdPlanForCustomer(customerId)
      if (!plan) return null

      const monthKey = isoTestDate.slice(0, 7) // YYYY-MM
      const cacheKey = `${siteId}|${plan.id}|${monthKey}`
      const cached = checkCache.get(cacheKey)
      if (cached) return cached

      // Look for an existing check at this site for the RCD plan in the same
      // month. Status filter excludes only cancelled — even completed checks
      // get re-used so a re-import lands on the original check.
      const monthStart = `${monthKey}-01`
      const monthEnd = `${monthKey}-31`
      const { data: existingChecks } = await supabase
        .from('maintenance_checks')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('site_id', siteId)
        .eq('job_plan_id', plan.id)
        .eq('is_active', true)
        .neq('status', 'cancelled')
        .gte('due_date', monthStart)
        .lte('due_date', monthEnd)
        .order('created_at', { ascending: true })
        .limit(1)

      const existing = existingChecks?.[0]
      if (existing) {
        checkCache.set(cacheKey, existing.id)
        return existing.id
      }

      // Create one. May visits cover the annual time-trip; other months are
      // push-button only.
      const month = parseInt(isoTestDate.slice(5, 7), 10)
      const frequency = month === 5 ? 'annual' : 'semi_annual'
      const { data: site } = await supabase
        .from('sites')
        .select('name')
        .eq('id', siteId)
        .maybeSingle()
      const dateObj = new Date(isoTestDate)
      const monthName = dateObj.toLocaleString('en-AU', { month: 'long' })
      const year = dateObj.getFullYear()
      const customName = `${site?.name ?? 'RCD'} - RCD Test - ${monthName} ${year}`

      const { data: created, error: createErr } = await supabase
        .from('maintenance_checks')
        .insert({
          tenant_id: tenantId,
          site_id: siteId,
          job_plan_id: plan.id,
          frequency,
          custom_name: customName,
          start_date: isoTestDate,
          due_date: isoTestDate,
          status: 'in_progress',
          assigned_to: user.id,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (createErr || !created) {
        // Don't fail the whole import for a check-creation issue. Leaving
        // check_id null still lands the rcd_tests rows.
        return null
      }
      checkCache.set(cacheKey, created.id)
      checksCreated++
      return created.id
    }

    let testsCreated = 0
    let circuitsCreated = 0
    let boardsSkipped = 0

    for (const t of parsed.tests) {
      const site = resolveSite(t.siteLabel)
      if (!site) {
        boardsSkipped++
        continue
      }
      const asset = resolveAsset(site.id, t.boardName)
      if (!asset) {
        boardsSkipped++
        continue
      }
      if (!t.testDate) {
        boardsSkipped++
        continue
      }
      const isoDate = t.testDate.toISOString().slice(0, 10)
      if (dupKeys.has(`${asset.id}|${isoDate}`)) {
        boardsSkipped++
        continue
      }

      const checkId = await findOrCreateRcdCheck(site.id, site.customer_id, isoDate)

      const { data: rcdTest, error: testErr } = await supabase
        .from('rcd_tests')
        .insert({
          tenant_id: tenantId,
          customer_id: site.customer_id ?? null,
          site_id: site.id,
          asset_id: asset.id,
          check_id: checkId,
          test_date: isoDate,
          technician_user_id: user.id,
          technician_name_snapshot: t.technicianName || null,
          technician_initials: t.technicianInitials || null,
          status: 'complete',
        })
        .select('id')
        .single()

      if (testErr || !rcdTest) {
        return {
          success: false,
          error: `Failed to insert rcd_tests for ${t.tabName}: ${testErr?.message ?? 'unknown error'}`,
        }
      }
      testsCreated++

      if (t.circuits.length === 0) continue

      const circuitRows = t.circuits.map((c, idx) => ({
        tenant_id: tenantId,
        rcd_test_id: rcdTest.id,
        section_label: c.sectionLabel,
        circuit_no: c.circuitNo,
        normal_trip_current_ma: c.normalTripCurrentMa,
        x1_no_trip_0_ms: c.x1NoTrip0Ms,
        x1_no_trip_180_ms: c.x1NoTrip180Ms,
        x1_trip_0_ms: c.x1Trip0Ms,
        x1_trip_180_ms: c.x1Trip180Ms,
        x5_fast_0_ms: c.x5Fast0Ms,
        x5_fast_180_ms: c.x5Fast180Ms,
        trip_test_button_ok: c.tripTestButtonOk,
        jemena_circuit_asset_id: c.jemenaCircuitAssetId,
        action_taken: c.actionTaken,
        is_critical_load: false,
        sort_order: idx,
      }))

      for (let i = 0; i < circuitRows.length; i += 500) {
        const batch = circuitRows.slice(i, i + 500)
        const { error: cErr } = await supabase.from('rcd_test_circuits').insert(batch)
        if (cErr) {
          // Roll back the just-created rcd_tests header so we don't leave an
          // empty parent row when the child batch fails. Best-effort cleanup —
          // an error here is logged but doesn't override the original error.
          await supabase.from('rcd_tests').delete().eq('id', rcdTest.id)
          testsCreated--
          return {
            success: false,
            error: `Failed to insert circuits for ${t.tabName}: ${cErr.message}`,
          }
        }
        circuitsCreated += batch.length
      }
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'rcd_test',
      summary: `Jemena RCD import: ${testsCreated} tests, ${circuitsCreated} circuits, ${checksCreated} checks created, ${boardsSkipped} boards skipped`,
      metadata: {
        source: 'jemena_rcd_xlsx',
        filename,
        testsCreated,
        circuitsCreated,
        checksCreated,
        boardsSkipped,
      },
      mutationId,
    })

    revalidatePath('/testing/rcd')
    revalidatePath('/maintenance')
    return {
      success: true,
      data: { testsCreated, circuitsCreated, boardsSkipped, checksCreated, filename },
    }
  })
}

// ── Helpers ─────────────────────────────────────────────────────────

function normaliseBoardName(s: string): string {
  let r = s.trim()
  r = r.replace(/^Main Distribution Board$/i, 'Main DB')
  r = r.replace(/^Distribution Board\s*-\s*/i, 'DB-')
  return r
}
