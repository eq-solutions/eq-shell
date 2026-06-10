'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite, canCreateCheck, isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency } from '@/lib/actions/idempotency'
import { createNotification } from '@/lib/actions/notifications'
import { notifyDefectRaised } from '@/lib/actions/defect-notifications'
import { firstRow } from '@/lib/db/relation'
import {
  CreateMaintenanceCheckSchema,
  UpdateMaintenanceCheckSchema,
  UpdateCheckItemResultSchema,
} from '@/lib/validations/maintenance-check'
import { RaiseDefectSchema, UpdateDefectSchema } from '@/lib/validations/defect'
import { zodToErrorMap } from '@/lib/utils/zodErrors'

/**
 * Every page that surfaces maintenance_checks counts/lists. Any mutation to a
 * check (create / update / archive / delete / complete / item result) must
 * invalidate all of these so the numbers don't drift out of sync.
 *
 * Kept as a single source of truth — add new paths here as new surfaces land.
 */
function revalidateMaintenanceSurfaces() {
  revalidatePath('/maintenance')
  revalidatePath('/testing/summary')
  revalidatePath('/dashboard')
  revalidatePath('/analytics')
  revalidatePath('/reports')
  revalidatePath('/sites', 'layout')
}

/**
 * Get the frequency flag column name for a given maintenance frequency.
 */
function freqColumn(freq: string): string {
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
  return map[freq] ?? 'freq_monthly'
}

/**
 * RCD test plans behave as a secondary overlay: their assets are RCD-bearing
 * boards (assets.expected_rcd_circuits > 0), even though those boards are
 * primarily pinned to a switchboard maintenance plan. Detect by code/name
 * pattern so any tenant can add their own `<TENANT>-RCD-TEST` plan.
 *
 * Anchored on word-boundaries so we don't match something like
 * "RCDS-Maintenance" or names that happen to contain the letters.
 */
function isRcdPlan(plan: { code: string | null; name: string | null }): boolean {
  const code = plan.code ?? ''
  const name = plan.name ?? ''
  if (/(^|[^A-Z])RCD([^A-Z]|$)/i.test(code)) return true
  if (/\brcd\b/i.test(name)) return true
  return false
}

/**
 * Preview which assets would be included in a check.
 * Used by the form to show a preview before creating.
 *
 * `jobPlanFilter` accepts either a single id (legacy) or an array of ids
 * (Simon 2026-04 feedback item 9 — multiple JCs per check). An empty
 * array or null means "no plan filter, return all site assets".
 */
export async function previewCheckAssetsAction(
  siteId: string,
  frequency: string,
  isDarkSite: boolean,
  jobPlanFilter?: string | string[] | null,
) {
  try {
    const { supabase } = await requireUser()

    // Normalise to an array. Dedupe defensively — the form can round-trip
    // the same id if the user toggles a checkbox quickly.
    const jobPlanIds = Array.isArray(jobPlanFilter)
      ? [...new Set(jobPlanFilter.filter(Boolean))]
      : jobPlanFilter
        ? [jobPlanFilter]
        : []

    // RCD overlay detection: when the user picked exactly one plan and that
    // plan is an RCD test plan, switch from "pinned plan match" to "asset has
    // RCD circuits" filtering. The switchboard maintenance plan is what the
    // boards are primarily pinned to; the RCD plan rides on top.
    let rcdOverlayPlanId: string | null = null
    let rcdOverlayPlanName: string | null = null
    if (jobPlanIds.length === 1) {
      const { data: plan } = await supabase
        .from('job_plans')
        .select('id, code, name')
        .eq('id', jobPlanIds[0])
        .maybeSingle()
      if (plan && isRcdPlan(plan)) {
        rcdOverlayPlanId = plan.id
        rcdOverlayPlanName = plan.name
      }
    }

    let query = supabase
      .from('assets')
      .select('id, name, maximo_id, location, job_plan_id, expected_rcd_circuits, job_plans(name, code)')
      .eq('site_id', siteId)
      .eq('is_active', true)

    if (isDarkSite) {
      query = query.eq('dark_site_test', true)
    }

    if (rcdOverlayPlanId) {
      // RCD overlay: surface every RCD-bearing asset at the site, regardless
      // of the asset's primary job_plan_id. Items come from the RCD plan
      // itself, not from each asset's pinned plan.
      query = query.gt('expected_rcd_circuits', 0)
    } else if (jobPlanIds.length === 1) {
      query = query.eq('job_plan_id', jobPlanIds[0])
    } else if (jobPlanIds.length > 1) {
      query = query.in('job_plan_id', jobPlanIds)
    }

    const { data: assets } = await query.order('name')

    if (!assets || assets.length === 0) {
      return { success: true, assets: [], totalTasks: 0 }
    }

    const col = freqColumn(frequency)

    // RCD overlay path: every surfaced asset shares the same task list pulled
    // from the RCD plan. No per-asset task lookup needed. Also surface the
    // prior-circuit count so the form can preview "X circuits will be
    // pre-populated from last visit" before the user commits.
    if (rcdOverlayPlanId) {
      const { data: rcdItems } = await supabase
        .from('job_plan_items')
        .select('id')
        .eq('job_plan_id', rcdOverlayPlanId)
        .eq(col, true)

      const taskCount = rcdItems?.length ?? 0
      if (taskCount === 0) {
        return { success: true, assets: [], totalTasks: 0 }
      }

      // Find the latest rcd_test per asset and count its circuits — this is
      // what'll be cloned onto the new check via createCheckAction's spawn
      // block. One query for the latest rcd_tests, one query for circuit
      // counts grouped by parent.
      const assetIds = assets.map((a) => a.id)
      // RLS already scopes by tenant — no explicit tenant_id filter needed.
      const { data: priorTests } = await supabase
        .from('rcd_tests')
        .select('id, asset_id, test_date')
        .in('asset_id', assetIds)
        .eq('is_active', true)
        .order('test_date', { ascending: false })

      const latestTestByAsset = new Map<string, string>()
      for (const t of priorTests ?? []) {
        if (!latestTestByAsset.has(t.asset_id)) latestTestByAsset.set(t.asset_id, t.id)
      }

      const latestTestIds = Array.from(latestTestByAsset.values())
      const circuitCountByTest = new Map<string, number>()
      if (latestTestIds.length > 0) {
        const { data: circuitRows } = await supabase
          .from('rcd_test_circuits')
          .select('rcd_test_id')
          .in('rcd_test_id', latestTestIds)
        for (const r of circuitRows ?? []) {
          circuitCountByTest.set(
            r.rcd_test_id,
            (circuitCountByTest.get(r.rcd_test_id) ?? 0) + 1,
          )
        }
      }

      return {
        success: true,
        assets: assets.map((a) => {
          const latestId = latestTestByAsset.get(a.id) ?? null
          const priorCircuits = latestId ? circuitCountByTest.get(latestId) ?? 0 : 0
          return {
            id: a.id,
            name: a.name,
            maximo_id: a.maximo_id,
            location: a.location,
            job_plan_name: rcdOverlayPlanName,
            task_count: taskCount,
            prior_circuit_count: priorCircuits,
          }
        }),
        totalTasks: assets.length * taskCount,
      }
    }

    // Standard path — task counts looked up per asset's pinned maintenance plan.
    const jpIds = [...new Set(assets.map((a) => a.job_plan_id).filter(Boolean))] as string[]
    let taskCountMap: Record<string, number> = {}
    if (jpIds.length > 0) {
      const { data: items } = await supabase
        .from('job_plan_items')
        .select('job_plan_id')
        .in('job_plan_id', jpIds)
        .eq(col, true)

      taskCountMap = (items ?? []).reduce((acc, item) => {
        acc[item.job_plan_id] = (acc[item.job_plan_id] || 0) + 1
        return acc
      }, {} as Record<string, number>)
    }

    const matchedAssets = assets.filter((a) => {
      if (!a.job_plan_id) return false
      return (taskCountMap[a.job_plan_id] ?? 0) > 0
    })

    const totalTasks = matchedAssets.reduce((sum, a) => {
      return sum + (taskCountMap[a.job_plan_id!] ?? 0)
    }, 0)

    return {
      success: true,
      assets: matchedAssets.map((a) => ({
        id: a.id,
        name: a.name,
        maximo_id: a.maximo_id,
        location: a.location,
        job_plan_name: firstRow(a.job_plans as { name: string; code: string | null } | { name: string; code: string | null }[] | null)?.name ?? null,
        task_count: taskCountMap[a.job_plan_id!] ?? 0,
      })),
      totalTasks,
    }
  } catch (e: unknown) {
    return { success: false, assets: [], totalTasks: 0, error: (e as Error).message }
  }
}

/**
 * Create a maintenance check with assets and per-asset tasks.
 *
 * Path A (by frequency): system finds all assets at site matching frequency
 * Path B (manual): user provides specific asset IDs
 */
export async function createCheckAction(formData: FormData) {
  try {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!canCreateCheck(role)) return { success: false, error: 'Insufficient permissions.' }

    // Parse manual_asset_ids from JSON if present
    const manualIdsRaw = formData.get('manual_asset_ids') as string | null
    const manualAssetIds = manualIdsRaw ? JSON.parse(manualIdsRaw) as string[] : undefined

    // Parse job_plan_ids JSON array (Simon 2026-04 feedback item 9 —
    // multi-JC support). Falls back to legacy single-id field.
    const jobPlanIdsRaw = formData.get('job_plan_ids') as string | null
    let jobPlanIds: string[] = []
    if (jobPlanIdsRaw) {
      try {
        const parsedIds = JSON.parse(jobPlanIdsRaw)
        if (Array.isArray(parsedIds)) jobPlanIds = parsedIds.filter((x): x is string => typeof x === 'string')
      } catch {
        return { success: false, error: 'Invalid job_plan_ids payload.' }
      }
    }
    const legacyJobPlanId = (formData.get('job_plan_id') as string | null) || null
    if (jobPlanIds.length === 0 && legacyJobPlanId) jobPlanIds = [legacyJobPlanId]

    const raw = {
      site_id: formData.get('site_id'),
      frequency: formData.get('frequency'),
      is_dark_site: formData.get('is_dark_site') === 'true',
      // Only stamp a single job_plan_id on the check record when the user
      // picked exactly one plan. Multi-plan checks leave this null — the
      // real filter lives in the items/assets we copy in below.
      job_plan_id: jobPlanIds.length === 1 ? jobPlanIds[0] : null,
      job_plan_ids: jobPlanIds,
      custom_name: formData.get('custom_name') || null,
      start_date: formData.get('start_date'),
      due_date: formData.get('due_date'),
      assigned_to: formData.get('assigned_to') || null,
      maximo_wo_number: formData.get('maximo_wo_number') || null,
      maximo_pm_number: formData.get('maximo_pm_number') || null,
      notes: formData.get('notes') || null,
      manual_asset_ids: manualAssetIds,
    }

    const parsed = CreateMaintenanceCheckSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    // Phase 0 enforcement (pre-visit tech brief): every new check
    // starts life as `status='scheduled'` (column default), so it must
    // have a technician assigned at creation time. Without that, the
    // Phase 1 brief email has nowhere to go and the row is invisible
    // on the tech's "My checks" surface. Audit-log the rejection — UX
    // events matter for shaking out flows that miss the assignee step.
    if (!parsed.data.assigned_to) {
      await logAuditEvent({
        action: 'reject',
        entityType: 'maintenance_check',
        summary: 'Rejected create: scheduled check requires assigned_to',
        metadata: { reason: 'scheduled_requires_assignee', site_id: parsed.data.site_id },
      })
      return {
        success: false,
        error: 'A technician must be assigned before scheduling this check. Use the Assign action first.',
      }
    }

    // Strip fields we don't want to persist on the maintenance_checks row.
    // `job_plan_ids` is a filter hint for asset selection below; it's not
    // a column on the DB table.
    const { manual_asset_ids: parsedManualIds, job_plan_ids: parsedJobPlanIds, ...checkData } = parsed.data
    const freq = parsed.data.frequency

    // Auto-generate name as "Site - Month - Year" if not provided
    if (!checkData.custom_name) {
      const { data: site } = await supabase
        .from('sites')
        .select('name')
        .eq('id', checkData.site_id)
        .single()

      const dateObj = new Date(checkData.start_date)
      const monthName = dateObj.toLocaleString('en-AU', { month: 'long' })
      const year = dateObj.getFullYear()
      checkData.custom_name = `${site?.name ?? 'Unknown'} - ${monthName} - ${year}`
    }

    // 1. Insert the maintenance check
    const { data: check, error: checkError } = await supabase
      .from('maintenance_checks')
      .insert({ ...checkData, tenant_id: tenantId })
      .select('id')
      .single()

    if (checkError || !check) return { success: false, error: checkError?.message ?? 'Failed to create check.' }

    // 2. Find assets to include
    //
    // RCD overlay: when the user picked exactly one plan and that plan is an
    // RCD test plan, surface every RCD-bearing asset at the site instead of
    // matching `assets.job_plan_id`. The boards live primarily on the
    // switchboard maintenance plan; the RCD plan rides on top.
    const planIds = parsedJobPlanIds ?? []
    let rcdOverlayPlanId: string | null = null
    if (planIds.length === 1 && (!parsedManualIds || parsedManualIds.length === 0)) {
      const { data: plan } = await supabase
        .from('job_plans')
        .select('id, code, name')
        .eq('id', planIds[0])
        .maybeSingle()
      if (plan && isRcdPlan(plan)) {
        rcdOverlayPlanId = plan.id
      }
    }

    let assetQuery = supabase
      .from('assets')
      .select('id, job_plan_id, expected_rcd_circuits')
      .eq('is_active', true)

    if (parsedManualIds && parsedManualIds.length > 0) {
      // Path B: specific assets
      assetQuery = assetQuery.in('id', parsedManualIds)
    } else {
      // Path A: all assets at site matching criteria
      assetQuery = assetQuery.eq('site_id', parsed.data.site_id)
      if (parsed.data.is_dark_site) {
        assetQuery = assetQuery.eq('dark_site_test', true)
      }
      if (rcdOverlayPlanId) {
        assetQuery = assetQuery.gt('expected_rcd_circuits', 0)
      } else if (planIds.length === 1) {
        // Multi-plan filter. Single id → .eq (uses idx_assets_job_plan_id);
        // multiple → .in. Zero ids means "no plan filter" (all assets at
        // the site). See lib/validations/maintenance-check.ts for shape.
        assetQuery = assetQuery.eq('job_plan_id', planIds[0])
      } else if (planIds.length > 1) {
        assetQuery = assetQuery.in('job_plan_id', planIds)
      }
    }

    const { data: assets } = await assetQuery

    if (!assets || assets.length === 0) {
      return { success: true, checkId: check.id, assetCount: 0, taskCount: 0 }
    }

    // 3. Get maintenance plan items matching the selected frequency
    const col = freqColumn(freq)

    // RCD overlay: items come from the RCD plan, not the asset's pinned plan.
    // Every asset shares the same task list, so we build a single items array
    // and replicate it per asset below.
    let rcdOverlayItems: {
      id: string
      description: string
      sort_order: number
      is_required: boolean
    }[] | null = null

    if (rcdOverlayPlanId) {
      const { data: rcdItems } = await supabase
        .from('job_plan_items')
        .select('id, description, sort_order, is_required')
        .eq('job_plan_id', rcdOverlayPlanId)
        .eq(col, true)
        .order('sort_order')
      rcdOverlayItems = rcdItems ?? []
      if (rcdOverlayItems.length === 0) {
        return { success: true, checkId: check.id, assetCount: 0, taskCount: 0 }
      }
    }

    const jpIds = [...new Set(assets.map((a) => a.job_plan_id).filter(Boolean))] as string[]
    let allItems: {
      id: string
      job_plan_id: string
      description: string
      sort_order: number
      is_required: boolean
    }[] = []

    if (!rcdOverlayPlanId && jpIds.length > 0) {
      const { data: items } = await supabase
        .from('job_plan_items')
        .select('id, job_plan_id, description, sort_order, is_required')
        .in('job_plan_id', jpIds)
        .eq(col, true)
        .order('sort_order')

      allItems = items ?? []
    }

    // Build lookup: job_plan_id → items
    const itemsByJP: Record<string, typeof allItems> = {}
    for (const item of allItems) {
      if (!itemsByJP[item.job_plan_id]) itemsByJP[item.job_plan_id] = []
      itemsByJP[item.job_plan_id].push(item)
    }

    // 4. Filter to assets whose maintenance plan has matching tasks
    const assetsWithTasks = rcdOverlayPlanId
      ? assets
      : assets.filter((a) => a.job_plan_id && (itemsByJP[a.job_plan_id]?.length ?? 0) > 0)

    if (assetsWithTasks.length === 0) {
      return { success: true, checkId: check.id, assetCount: 0, taskCount: 0 }
    }

    // 5. Create check_assets rows
    const checkAssetRows = assetsWithTasks.map((a) => ({
      tenant_id: tenantId,
      check_id: check.id,
      asset_id: a.id,
      status: 'pending',
    }))

    const { data: insertedCA, error: caError } = await supabase
      .from('check_assets')
      .insert(checkAssetRows)
      .select('id, asset_id')

    if (caError || !insertedCA) return { success: false, error: caError?.message ?? 'Failed to create check assets.' }

    // 6. Create check_items for each asset (from its maintenance plan items, or the
    //    RCD overlay's items when the selected plan is RCD-TEST)
    const caLookup: Record<string, string> = {}
    for (const ca of insertedCA) {
      caLookup[ca.asset_id] = ca.id
    }

    const checkItems: {
      tenant_id: string
      check_id: string
      check_asset_id: string
      job_plan_item_id: string
      asset_id: string
      description: string
      sort_order: number
      is_required: boolean
    }[] = []

    for (const asset of assetsWithTasks) {
      const caId = caLookup[asset.id]
      const jpItems = rcdOverlayItems ?? itemsByJP[asset.job_plan_id!] ?? []
      for (const item of jpItems) {
        checkItems.push({
          tenant_id: tenantId,
          check_id: check.id,
          check_asset_id: caId,
          job_plan_item_id: item.id,
          asset_id: asset.id,
          description: item.description,
          sort_order: item.sort_order,
          is_required: item.is_required,
        })
      }
    }

    // Insert in batches of 500
    for (let i = 0; i < checkItems.length; i += 500) {
      const batch = checkItems.slice(i, i + 500)
      const { error: itemsError } = await supabase
        .from('maintenance_check_items')
        .insert(batch)
      if (itemsError) return { success: false, error: itemsError.message }
    }

    // 7. RCD overlay: spawn one rcd_tests per asset, copying the circuit
    //    structure (section, circuit_no, rating, jemena id, critical flag)
    //    from the most recent prior test for that asset. Timing values are
    //    left null so the tech overwrites them onsite via /testing/rcd/[id].
    //
    //    No prior test for an asset → empty rcd_tests row spawned anyway,
    //    so /maintenance > check page shows the link and onsite tech can
    //    enumerate circuits manually (or import xlsx).
    let rcdTestsCreated = 0
    let circuitsCopied = 0
    if (rcdOverlayPlanId && !parsedManualIds?.length) {
      const assetIds = assetsWithTasks.map((a) => a.id)

      // Single query to fetch every prior rcd_test for these assets,
      // ordered newest-first so the first row per asset is the latest.
      const { data: priorTests } = await supabase
        .from('rcd_tests')
        .select('id, asset_id, test_date')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('asset_id', assetIds)
        .order('test_date', { ascending: false })

      const latestByAsset = new Map<string, string>()
      for (const t of priorTests ?? []) {
        if (!latestByAsset.has(t.asset_id)) latestByAsset.set(t.asset_id, t.id)
      }

      // Resolve site customer_id once (rcd_tests carries it for filtering).
      const { data: siteRow } = await supabase
        .from('sites')
        .select('customer_id')
        .eq('id', parsed.data.site_id)
        .maybeSingle()

      const newTestRows = assetsWithTasks.map((a) => ({
        tenant_id: tenantId,
        customer_id: siteRow?.customer_id ?? null,
        site_id: parsed.data.site_id,
        asset_id: a.id,
        check_id: check.id,
        test_date: parsed.data.due_date,
        technician_user_id: user.id,
        status: 'draft',
      }))

      const { data: newTests, error: newTestsErr } = await supabase
        .from('rcd_tests')
        .insert(newTestRows)
        .select('id, asset_id')

      if (newTestsErr) {
        return { success: false, error: `Failed to spawn RCD tests: ${newTestsErr.message}` }
      }
      rcdTestsCreated = newTests?.length ?? 0

      // Copy circuit structure from prior test → new test, blanking timing
      // values. Per-asset because the source test id varies; in practice this
      // is at most ~50 boards per check so the overhead is negligible.
      for (const newTest of newTests ?? []) {
        const priorId = latestByAsset.get(newTest.asset_id)
        if (!priorId) continue

        const { data: priorCircuits } = await supabase
          .from('rcd_test_circuits')
          .select(
            'section_label, circuit_no, normal_trip_current_ma, jemena_circuit_asset_id, is_critical_load, sort_order',
          )
          .eq('rcd_test_id', priorId)
          .order('sort_order')

        if (!priorCircuits || priorCircuits.length === 0) continue

        const newCircuits = priorCircuits.map((c) => ({
          tenant_id: tenantId,
          rcd_test_id: newTest.id,
          section_label: c.section_label,
          circuit_no: c.circuit_no,
          normal_trip_current_ma: c.normal_trip_current_ma,
          jemena_circuit_asset_id: c.jemena_circuit_asset_id,
          is_critical_load: c.is_critical_load,
          sort_order: c.sort_order,
          // Timing values + button check + action_taken intentionally left
          // at column defaults (null / false). Tech captures fresh values
          // on the visit.
        }))

        for (let i = 0; i < newCircuits.length; i += 500) {
          const batch = newCircuits.slice(i, i + 500)
          const { error: copyErr } = await supabase
            .from('rcd_test_circuits')
            .insert(batch)
          if (copyErr) {
            return {
              success: false,
              error: `Failed to copy circuits for asset ${newTest.asset_id}: ${copyErr.message}`,
            }
          }
          circuitsCopied += batch.length
        }
      }

      revalidatePath('/testing/rcd')
    }

    // 8. Notification if assigned
    if (parsed.data.assigned_to) {
      const siteName = parsed.data.custom_name ?? 'Maintenance Check'
      await createNotification({
        tenantId,
        userId: parsed.data.assigned_to as string,
        type: 'check_assigned',
        title: `You've been assigned: ${siteName}`,
        body: `Due date: ${parsed.data.due_date} · ${assetsWithTasks.length} assets · ${checkItems.length} tasks`,
        entityType: 'maintenance_check',
        entityId: check.id,
      })
    }

    // Phase 3 (Phase 1 of bridge plan, soft variant): if exactly one job
    // plan was picked, look up scope context and stamp it into the audit
    // log metadata. Doesn't block creation — the chip in CreateCheckForm
    // already shows the operator the status and they consciously hit
    // Create. The audit trail makes after-the-fact review of out-of-scope
    // work straightforward.
    let scopeStatusAtCreate: string | null = null
    let scopeMatchedYear: string | null = null
    if (jobPlanIds.length === 1) {
      try {
        const { getScopeContext } = await import('@/lib/scope-context/getScopeContext')
        const { data: siteRow } = await supabase
          .from('sites').select('customer_id').eq('id', checkData.site_id).maybeSingle()
        if (siteRow?.customer_id) {
          const ctx = await getScopeContext(supabase, {
            customerId: siteRow.customer_id as string,
            siteId: checkData.site_id,
            jobPlanId: jobPlanIds[0],
          })
          scopeStatusAtCreate = ctx.status
          scopeMatchedYear = ctx.matched_year
        }
      } catch {
        // never block creation on a scope-lookup failure
      }
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      entityId: check.id,
      summary: rcdOverlayPlanId
        ? `Created RCD check: ${assetsWithTasks.length} assets, ${rcdTestsCreated} RCD tests pre-populated (${circuitsCopied} circuits copied) (${freq})`
        : `Created check: ${assetsWithTasks.length} assets, ${checkItems.length} tasks (${freq})`,
      metadata: scopeStatusAtCreate
        ? {
            scope_status_at_create: scopeStatusAtCreate,
            scope_matched_year: scopeMatchedYear,
            site_id: checkData.site_id,
            job_plan_id: jobPlanIds[0],
          }
        : { site_id: checkData.site_id, job_plan_ids: jobPlanIds },
    })

    revalidateMaintenanceSurfaces()
    return {
      success: true,
      checkId: check.id,
      assetCount: assetsWithTasks.length,
      taskCount: checkItems.length,
      rcdTestsCreated,
      circuitsCopied,
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a maintenance check (status, assigned_to, notes, dates).
 */
export async function updateCheckAction(id: string, formData: FormData) {
  try {
    const { supabase, role, user, tenantId } = await requireUser()

    // Check if user can update: write role OR assigned technician
    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status, job_plans(name)')
      .eq('id', id)
      .single()

    if (!existing) return { success: false, error: 'Check not found.' }
    const isAssigned = existing.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const raw: Record<string, unknown> = {}
    if (formData.has('status')) raw.status = formData.get('status')
    if (formData.has('assigned_to')) raw.assigned_to = formData.get('assigned_to') || null
    if (formData.has('due_date')) raw.due_date = formData.get('due_date')
    if (formData.has('notes')) raw.notes = formData.get('notes') || null
    if (formData.has('started_at')) raw.started_at = formData.get('started_at') || null
    if (formData.has('completed_at')) raw.completed_at = formData.get('completed_at') || null

    const parsed = UpdateMaintenanceCheckSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    // Phase 0 enforcement (pre-visit tech brief): block transitions
    // into `status='scheduled'` when no technician is assigned. Looks
    // at the *resulting* assignment — the update payload wins over the
    // existing value, mirroring how the SQL UPDATE would behave.
    if (parsed.data.status === 'scheduled') {
      // Determine the assigned_to that will be in effect after this
      // update. If the form explicitly includes assigned_to (even as
      // null), that value wins; otherwise we fall through to the
      // existing row's value.
      const resultingAssignee = 'assigned_to' in parsed.data
        ? parsed.data.assigned_to
        : existing.assigned_to
      if (!resultingAssignee) {
        await logAuditEvent({
          action: 'reject',
          entityType: 'maintenance_check',
          entityId: id,
          summary: 'Rejected status→scheduled: requires assigned_to',
          metadata: {
            reason: 'scheduled_requires_assignee',
            previous_status: existing.status,
          },
        })
        return {
          success: false,
          error: 'A technician must be assigned before scheduling this check. Use the Assign action first.',
        }
      }
    }

    const { error } = await supabase
      .from('maintenance_checks')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    // Create notification if assigned_to changed
    if (formData.has('assigned_to') && parsed.data.assigned_to && parsed.data.assigned_to !== existing.assigned_to) {
      const jpData = firstRow(existing.job_plans as { name: string } | { name: string }[] | null)
      const jobPlanName = jpData?.name ?? 'Maintenance Check'
      await createNotification({
        tenantId,
        userId: parsed.data.assigned_to as string,
        type: 'check_assigned',
        title: `You've been assigned a maintenance check: ${jobPlanName}`,
        entityType: 'maintenance_check',
        entityId: id,
      })
    }

    await logAuditEvent({ action: 'update', entityType: 'maintenance_check', entityId: id, summary: 'Updated maintenance check' })

    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Start a check — sets status to in_progress and started_at.
 */
export async function startCheckAction(id: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', id)
      .single()

    if (!existing) return { success: false, error: 'Check not found.' }
    if (existing.status !== 'scheduled' && existing.status !== 'overdue') {
      return { success: false, error: 'Check cannot be started in its current state.' }
    }

    const isAssigned = existing.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'maintenance_check', entityId: id, summary: 'Started maintenance check' })
    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Complete a check — validates all required items have results, then sets status to complete.
 */
export async function completeCheckAction(id: string) {
  try {
    const { supabase, role, user, tenantId } = await requireUser()

    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status, job_plans(name)')
      .eq('id', id)
      .single()

    if (!existing) return { success: false, error: 'Check not found.' }
    if (existing.status !== 'in_progress') {
      return { success: false, error: 'Check must be in progress to complete.' }
    }

    const isAssigned = existing.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    // Validate all required items have results
    const { data: incompleteItems } = await supabase
      .from('maintenance_check_items')
      .select('id')
      .eq('check_id', id)
      .eq('is_required', true)
      .is('result', null)

    if (incompleteItems && incompleteItems.length > 0) {
      return { success: false, error: `${incompleteItems.length} required task(s) still need a result.` }
    }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    // Create notification to assigned technician's supervisor (if assigned)
    if (existing.assigned_to && existing.assigned_to !== user.id) {
      const jpData = firstRow(existing.job_plans as { name: string } | { name: string }[] | null)
      const jobPlanName = jpData?.name ?? 'Maintenance Check'
      await createNotification({
        tenantId,
        userId: existing.assigned_to as string,
        type: 'check_completed',
        title: `Maintenance check completed: ${jobPlanName}`,
        body: 'This check has been marked as complete.',
        entityType: 'maintenance_check',
        entityId: id,
      })
    }

    await logAuditEvent({ action: 'update', entityType: 'maintenance_check', entityId: id, summary: 'Completed maintenance check' })
    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Re-open a completed check — Sprint 3.3 (2026-04-26).
 *
 * Decision context: site reality is that techs finish a check, then a defect
 * surfaces during pack-up or the customer adds a follow-up WO at handover.
 * Hard-locking the check creates ugly workarounds. So: any user with write
 * access can reopen, full audit trail captures who/when/what changes.
 *
 * Behaviour:
 *   - Status flips back from 'complete' → 'in_progress'.
 *   - completed_at is preserved (so we know when the original close happened).
 *   - Audit log entry: action='update', summary marks it as a re-open.
 *   - Future report regeneration: existing PDF stays at v1, next generation
 *     becomes v2.pdf — wired via the report-deliveries revision counter.
 *
 * Open follow-up (2026-05-21 audit): the original design called for a
 * dedicated `amended_at` column to track each re-open distinct from the
 * original close. The column was never added and this action never bumped
 * one. For now the audit_logs table is the source of truth for re-open
 * history; if amend timeline becomes a first-class report field, add the
 * column via migration and update this action to bump it.
 *
 * No reason field required (per Royce 26-Apr decision — reduces friction).
 * The audit log captures who and when; the diff itself is implicit in the
 * subsequent edits the user makes.
 */
export async function reopenCheckAction(id: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', id)
      .single()

    if (!existing) return { success: false, error: 'Check not found.' }
    if (existing.status !== 'complete') {
      return { success: false, error: 'Only completed checks can be re-opened.' }
    }

    const isAssigned = existing.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status: 'in_progress' })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check',
      entityId: id,
      summary: 'Re-opened completed maintenance check (amend)',
    })
    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Cancel a check — admin only.
 */
export async function cancelCheckAction(id: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status: 'cancelled' })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'maintenance_check', entityId: id, summary: 'Cancelled maintenance check' })
    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Archive (soft-delete) a maintenance check — admin only.
 * Hides the check from default list views. Set `active` = true to restore.
 */
export async function archiveCheckAction(id: string, active = false) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin only.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ is_active: active })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: active ? 'reactivate' : 'deactivate',
      entityType: 'maintenance_check',
      entityId: id,
      summary: `${active ? 'Restored' : 'Archived'} maintenance check`,
    })
    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a check item result (pass/fail/na + notes).
 *
 * Idempotent when called with a `mutationId` — safe to replay from offline
 * queue or retry on transient network failure. The audit row carries the
 * `mutation_id`, so a second call with the same id is detected and skipped.
 */
export async function updateCheckItemAction(
  checkId: string,
  itemId: string,
  formData: FormData,
  mutationId?: string,
) {
  return withIdempotency(mutationId, async () => {
    const { supabase, role, user } = await requireUser()

    // Verify check ownership/assignment
    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    // 2026-04-28: items remain editable when the check is `complete`. Royce's
    // workflow: bulk-complete all assets first (most pass), then go back and
    // downgrade the few failures. The previous lock fired too early. Audit
    // log captures every flip so the change history stays auditable.
    // Scheduled / cancelled remain blocked — those are pre-work or terminal.
    if (check.status !== 'in_progress' && check.status !== 'complete') {
      return { success: false, error: 'Check must be in progress or complete to update items.' }
    }

    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      result: formData.get('result') || null,
      notes: formData.get('notes') || null,
    }

    const parsed = UpdateCheckItemResultSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    const updateData: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.result) {
      updateData.completed_at = new Date().toISOString()
      updateData.completed_by = user.id
    } else {
      updateData.completed_at = null
      updateData.completed_by = null
    }

    const { error } = await supabase
      .from('maintenance_check_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('check_id', checkId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check_item',
      entityId: itemId,
      summary: `Check item ${parsed.data.result ?? 'cleared'}`,
      metadata: { check_id: checkId, result: parsed.data.result, notes: parsed.data.notes },
      mutationId,
    })

    revalidateMaintenanceSurfaces()
    return { success: true }
  })
}

/**
 * Batch create maintenance checks from a maintenance plan between start and end dates.
 * Calculates check dates based on maintenance plan frequency.
 * Max 52 checks per batch (1 year of weeklies).
 */
export async function batchCreateChecksAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const jobPlanId = formData.get('job_plan_id') as string
    const startDate = formData.get('start_date') as string
    const endDate = formData.get('end_date') as string
    const assignedTo = (formData.get('assigned_to') as string) || null

    if (!jobPlanId || !startDate || !endDate) {
      return { success: false, error: 'Job plan, start date, and end date are required.' }
    }

    // Phase 0 enforcement (pre-visit tech brief): batch-created
    // checks all land as `status='scheduled'` (see insert below), so
    // they need an assignee for the same reason single-creates do.
    if (!assignedTo) {
      await logAuditEvent({
        action: 'reject',
        entityType: 'maintenance_check',
        summary: 'Rejected batch-create: scheduled checks require assigned_to',
        metadata: {
          reason: 'scheduled_requires_assignee',
          job_plan_id: jobPlanId,
        },
      })
      return {
        success: false,
        error: 'A technician must be assigned before scheduling these checks. Pick a technician in the form before continuing.',
      }
    }

    // Fetch maintenance plan
    const { data: jobPlan } = await supabase
      .from('job_plans')
      .select('id, site_id, frequency')
      .eq('id', jobPlanId)
      .single()

    if (!jobPlan) return { success: false, error: 'Job plan not found.' }

    // Generate check dates based on frequency
    const start = new Date(startDate)
    const end = new Date(endDate)
    const checkDates: Date[] = []

    const frequency = jobPlan.frequency as string
    let current = new Date(start)

    while (current <= end && checkDates.length < 52) {
      checkDates.push(new Date(current))

      // Advance to next interval based on frequency
      if (frequency === 'weekly') {
        current.setDate(current.getDate() + 7)
      } else if (frequency === 'monthly') {
        current.setMonth(current.getMonth() + 1)
      } else if (frequency === 'quarterly') {
        current.setMonth(current.getMonth() + 3)
      } else if (frequency === 'biannual') {
        current.setMonth(current.getMonth() + 6)
      } else if (frequency === 'annual') {
        current.setFullYear(current.getFullYear() + 1)
      } else {
        // ad_hoc: just use start date
        break
      }
    }

    if (checkDates.length === 0) {
      return { success: false, error: 'No check dates generated for the given range.' }
    }

    // Fetch maintenance plan items once
    const { data: planItems } = await supabase
      .from('job_plan_items')
      .select('id, asset_id, description, sort_order, is_required')
      .eq('job_plan_id', jobPlanId)
      .order('sort_order')

    // Create checks and their items
    let createdCount = 0
    for (const dueDate of checkDates) {
      const dueDateStr = dueDate.toISOString().split('T')[0]

      // Insert the check. The generated Insert shape narrows some FK
      // columns to non-null strings even though the DB allows null; cast
      // the values record through unknown so the explicit-null assigned_to
      // path keeps working at runtime.
      const insertValues: Record<string, unknown> = {
        tenant_id: tenantId,
        job_plan_id: jobPlanId,
        site_id: jobPlan.site_id,
        assigned_to: assignedTo,
        status: 'scheduled',
        due_date: dueDateStr,
        notes: null,
      }
      const { data: check } = await supabase
        .from('maintenance_checks')
        .insert(insertValues as never)
        .select('id')
        .single()

      if (!check) continue

      // Copy maintenance plan items into check items
      if (planItems && planItems.length > 0) {
        const checkItems = planItems.map((item) => ({
          tenant_id: tenantId,
          check_id: check.id,
          job_plan_item_id: item.id,
          asset_id: item.asset_id,
          description: item.description,
          sort_order: item.sort_order,
          is_required: item.is_required,
        }))

        await supabase
          .from('maintenance_check_items')
          .insert(checkItems)
      }

      createdCount += 1
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Batch created ${createdCount} checks from maintenance plan`,
    })

    revalidateMaintenanceSurfaces()
    return { success: true, created: createdCount }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Force-complete a check asset — marks the asset as completed and all its check items as 'pass'.
 */
export async function forceCompleteCheckAssetAction(checkId: string, checkAssetId: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const now = new Date().toISOString()

    // Mark all check items for this asset as pass
    const { error: itemsErr } = await supabase
      .from('maintenance_check_items')
      .update({ result: 'pass', completed_at: now, completed_by: user.id })
      .eq('check_asset_id', checkAssetId)
      .is('result', null)

    if (itemsErr) return { success: false, error: itemsErr.message }

    // Mark the check_asset as completed
    const { error: caErr } = await supabase
      .from('check_assets')
      .update({ status: 'completed', completed_at: now })
      .eq('id', checkAssetId)

    if (caErr) return { success: false, error: caErr.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'check_asset',
      entityId: checkAssetId,
      summary: 'Force-completed check asset and its items',
    })

    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Bulk update work order numbers on check_assets.
 * Accepts an array of { checkAssetId, workOrderNumber } pairs.
 */
export async function bulkUpdateWorkOrdersAction(
  checkId: string,
  updates: { checkAssetId: string; workOrderNumber: string }[]
) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    // Track per-row outcomes so the client can surface partial failures.
    // Previously the loop swallowed every per-row error and returned an
    // aggregate { success: true } — a paste of 50 WOs with 30 RLS rejects
    // looked indistinguishable from a clean 50/50 success. Audit 2026-05-13.
    let updated = 0
    const failed: string[] = []
    for (const { checkAssetId, workOrderNumber } of updates) {
      const { error } = await supabase
        .from('check_assets')
        .update({ work_order_number: workOrderNumber || null })
        .eq('id', checkAssetId)
        .eq('check_id', checkId)

      if (error) failed.push(checkAssetId)
      else updated++
    }

    if (updated > 0) {
      await logAuditEvent({
        action: 'update',
        entityType: 'maintenance_check',
        entityId: checkId,
        summary: `Bulk-updated work order numbers on ${updated} check asset(s)${failed.length > 0 ? ` (${failed.length} failed)` : ''}`,
      })
    }

    revalidateMaintenanceSurfaces()
    return { success: true, updated, failed }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a check asset's notes or work order number.
 */
export async function updateCheckAssetAction(
  checkId: string,
  checkAssetId: string,
  data: { notes?: string; work_order_number?: string }
) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('check_assets')
      .update(data)
      .eq('id', checkAssetId)
      .eq('check_id', checkId)

    if (error) return { success: false, error: error.message }

    const fields = Object.keys(data).join(', ')
    await logAuditEvent({
      action: 'update',
      entityType: 'check_asset',
      entityId: checkAssetId,
      summary: `Updated check asset (${fields})`,
    })

    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Complete ALL assets in a check at once.
 * Marks every incomplete item as 'pass' and every check_asset as 'completed'.
 */
export async function raiseDefectAction(data: {
  check_id: string
  check_asset_id?: string
  asset_id?: string
  site_id?: string
  title: string
  description?: string
  severity: string
}) {
  try {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    // Zod validation — AGENTS.md requires schema validation on all mutating
    // server actions. The TS signature already constrains compile-time
    // callers; this is runtime defence-in-depth.
    const parsed = RaiseDefectSchema.safeParse(data)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid defect input.' }
    }
    const input = parsed.data

    const { data: insertedRows, error } = await supabase
      .from('defects')
      .insert({
        tenant_id: tenantId,
        check_id: input.check_id,
        check_asset_id: input.check_asset_id || null,
        asset_id: input.asset_id || null,
        site_id: input.site_id || null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        severity: input.severity,
        status: 'open',
        raised_by: user.id,
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }

    // Fan-out the defect_raised notifications. Helper handles role
    // recipient policy + critical-escalation + RLS via service role.
    await notifyDefectRaised({
      tenantId,
      defectId: insertedRows.id,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      severity: input.severity,
    })

    await logAuditEvent({ action: 'create', entityType: 'defect', summary: `Raised defect: "${input.title}"` })
    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateDefectAction(defectId: string, updates: {
  status?: string
  severity?: string
  assigned_to?: string | null
  resolution_notes?: string
  work_order_number?: string | null
  work_order_date?: string | null
}) {
  try {
    const { supabase, role, user } = await requireUser()

    // Zod validation — AGENTS.md requires schema validation on all mutating
    // server actions. Status / severity enums are now enforced at runtime.
    const parsed = UpdateDefectSchema.safeParse(updates)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid defect update.' }
    }
    const input = parsed.data

    // Technicians can update defects assigned to them; writers can update any
    if (!canWrite(role)) {
      const { data: defect } = await supabase
        .from('defects')
        .select('assigned_to')
        .eq('id', defectId)
        .maybeSingle()
      if (!defect || defect.assigned_to !== user.id) {
        return { success: false, error: 'Insufficient permissions.' }
      }
    }

    const updateData: Record<string, unknown> = {}
    if (input.status) updateData.status = input.status
    if (input.severity) updateData.severity = input.severity
    if (input.assigned_to !== undefined) updateData.assigned_to = input.assigned_to
    if (input.resolution_notes !== undefined) updateData.resolution_notes = input.resolution_notes
    if (input.work_order_number !== undefined) updateData.work_order_number = input.work_order_number
    if (input.work_order_date !== undefined) updateData.work_order_date = input.work_order_date

    if (input.status === 'resolved' || input.status === 'closed') {
      updateData.resolved_at = new Date().toISOString()
      updateData.resolved_by = user.id
    }

    const { error } = await supabase
      .from('defects')
      .update(updateData)
      .eq('id', defectId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'defect', entityId: defectId, summary: `Updated defect: ${updates.status ? `status → ${updates.status}` : 'fields updated'}` })
    revalidateMaintenanceSurfaces()
    revalidatePath('/defects')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function completeAllCheckAssetsAction(checkId: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const now = new Date().toISOString()

    // Mark all incomplete items as pass
    const { error: itemsErr } = await supabase
      .from('maintenance_check_items')
      .update({ result: 'pass', completed_at: now, completed_by: user.id })
      .eq('check_id', checkId)
      .is('result', null)

    if (itemsErr) return { success: false, error: itemsErr.message }

    // Mark all non-completed check_assets as completed
    const { error: caErr } = await supabase
      .from('check_assets')
      .update({ status: 'completed', completed_at: now })
      .eq('check_id', checkId)
      .neq('status', 'completed')

    if (caErr) return { success: false, error: caErr.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check',
      entityId: checkId,
      summary: 'Marked all remaining check assets + items complete (Complete All)',
    })

    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Batch force-complete multiple assets at once.
 * Marks each asset as completed and all its incomplete items as 'pass'.
 */
export async function batchForceCompleteAssetsAction(checkId: string, checkAssetIds: string[]) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    if (!checkAssetIds || checkAssetIds.length === 0) {
      return { success: false, error: 'No assets selected.' }
    }

    const now = new Date().toISOString()

    // Mark all incomplete items for selected assets as pass
    const { error: itemsErr } = await supabase
      .from('maintenance_check_items')
      .update({ result: 'pass', completed_at: now, completed_by: user.id })
      .in('check_asset_id', checkAssetIds)
      .is('result', null)

    if (itemsErr) return { success: false, error: itemsErr.message }

    // Mark all selected check_assets as completed
    const { error: caErr } = await supabase
      .from('check_assets')
      .update({ status: 'completed', completed_at: now })
      .in('id', checkAssetIds)

    if (caErr) return { success: false, error: caErr.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check',
      entityId: checkId,
      summary: `Force-completed ${checkAssetIds.length} check asset(s) and their items`,
    })

    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a check item result (pass/fail/na/null + comments).
 */
export async function updateCheckItemResultAction(
  checkId: string,
  itemId: string,
  result: 'pass' | 'fail' | 'na' | null,
  comment?: string
) {
  try {
    const { supabase, role, user } = await requireUser()

    // Verify check ownership/assignment
    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }

    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    // Build the update payload
    const updateData: Record<string, unknown> = {}

    if (result === null) {
      updateData.result = null
      updateData.completed_at = null
      updateData.completed_by = null
    } else {
      updateData.result = result
      updateData.completed_at = new Date().toISOString()
      updateData.completed_by = user.id
    }

    if (comment !== undefined) {
      updateData.notes = comment || null
    }

    // Get the current item to check its asset
    const { data: item } = await supabase
      .from('maintenance_check_items')
      .select('check_asset_id, result')
      .eq('id', itemId)
      .eq('check_id', checkId)
      .single()

    if (!item) return { success: false, error: 'Item not found.' }

    // Update the item
    const { error: itemErr } = await supabase
      .from('maintenance_check_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('check_id', checkId)

    if (itemErr) return { success: false, error: itemErr.message }

    // If changing a task to 'fail', revert the asset status from 'completed' to 'pending'
    if (result === 'fail' && item.check_asset_id) {
      const { data: asset } = await supabase
        .from('check_assets')
        .select('status')
        .eq('id', item.check_asset_id)
        .single()

      if (asset && asset.status === 'completed') {
        const { error: assetErr } = await supabase
          .from('check_assets')
          .update({ status: 'pending', completed_at: null })
          .eq('id', item.check_asset_id)

        if (assetErr) return { success: false, error: assetErr.message }
      }
    }

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check_item',
      entityId: itemId,
      summary: result === null
        ? 'Cleared item result'
        : `Set item result to ${result}${comment ? ' (with comment)' : ''}`,
    })

    revalidateMaintenanceSurfaces()
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
