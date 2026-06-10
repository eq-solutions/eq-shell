'use server'

/**
 * generate-and-store.ts
 *
 * Shared helper: generates DOCX for a maintenance check, uploads to
 * Supabase Storage, computes SHA-256 hash, returns paths + hash.
 *
 * This is called by issueMaintenanceReportAction (reports/actions.ts)
 * and could later be called by a batch-generation cron.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { generatePMCheckReport } from '@/lib/reports/pm-check-report'
import type { PmCheckReportInput, PmCheckReportItem } from '@/lib/reports/pm-check-report'
import { generateWorkOrderDetailsReport } from '@/lib/reports/work-order-details'
import type { WorkOrderDetailsInput, WorkOrderDetailsAsset, WorkOrderTask, WorkOrderDefect } from '@/lib/reports/work-order-details'
import { fetchLogoImage } from '@/lib/reports/report-branding'
import { LOGO_DEFAULT } from '@/lib/reports/sizing'
import { convertDocxToPdf } from '@/lib/reports/pdf-conversion'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface GeneratedReport {
  docxPath: string
  pdfPath: string | null // null until PDF generation is wired
  contentHash: string // SHA-256 hex of the DOCX
  docxBuffer: Buffer
}

/**
 * Generate a DOCX report for a maintenance check, upload to Storage,
 * and return the paths + content hash.
 *
 * Uses the _user's_ Supabase client for data reads (RLS-scoped) and
 * the admin client for Storage writes (service role — Storage RLS is
 * separate from table RLS and we need bucket write access).
 */
export async function generateAndStoreReport(
  supabase: SupabaseClient,
  tenantId: string,
  maintenanceCheckId: string,
  revision: number,
): Promise<GeneratedReport> {
  // ── Fetch maintenance check ──
  const { data: check, error: checkError } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name), sites(name, customer_id)')
    .eq('id', maintenanceCheckId)
    .single()

  if (checkError || !check) {
    throw new Error(`Failed to fetch maintenance check: ${checkError?.message ?? 'not found'}`)
  }

  // ── Fetch customer logo (if site has a customer) ──
  const siteRow = check.sites as { name: string; customer_id?: string | null } | null
  let customerLogoUrl: string | null = null
  if (siteRow?.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('logo_url')
      .eq('id', siteRow.customer_id)
      .maybeSingle()
    customerLogoUrl = customer?.logo_url ?? null
  }

  // ── Fetch check items ──
  const { data: items, error: itemsError } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', maintenanceCheckId)
    .order('sort_order')

  if (itemsError || !items) {
    throw new Error(`Failed to fetch check items: ${itemsError?.message ?? 'empty'}`)
  }

  // ── Fetch tenant settings for branding via the cached helper ──
  // report_customer_logo dropped 26-Apr-2026 (audit item 8) — customer logo
  // is now always shown on the cover when present.
  const tenantSettings = await getCachedTenantSettings(tenantId)

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const deepColour = tenantSettings?.deep_colour ?? null
  const iceColour = tenantSettings?.ice_colour ?? null
  const inkColour = tenantSettings?.ink_colour ?? null
  const companyName = tenantSettings?.report_company_name ?? null
  const reportLogoUrl = tenantSettings?.report_logo_url ?? null

  // ── Fetch tenant for fallback logo ──
  const { data: tenant } = await supabase
    .from('tenants')
    .select('logo_url')
    .eq('id', tenantId)
    .maybeSingle()

  const tenantLogoUrl = reportLogoUrl || tenant?.logo_url || null

  // Customer logo always rendered when present (was gated on
  // report_customer_logo toggle until 26-Apr-2026 — see audit item 8).
  const finalCustomerLogoUrl = customerLogoUrl

  // ── Resolve user display names ──
  const userIds = [
    check.assigned_to,
    ...items.flatMap((i: Record<string, unknown>) => [i.completed_by]).filter(Boolean),
  ].filter(Boolean) as string[]

  const userMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      userMap[p.id] = p.full_name ?? p.email
    }
  }

  // ── Build report input ──
  const reportItems: PmCheckReportItem[] = items.map((item: Record<string, unknown>, idx: number) => ({
    number: idx + 1,
    description: item.description as string,
    result: item.result as 'pass' | 'fail' | 'na' | null,
    notes: item.notes as string | null,
    completedBy: item.completed_by ? (userMap[item.completed_by as string] ?? null) : null,
    completedAt: item.completed_at as string | null,
  }))

  const siteName = (check.sites as { name: string } | null)?.name ?? 'Unknown Site'
  const jobPlanName = (check.job_plans as { name: string } | null)?.name ?? 'Unknown Job Plan'

  // ── Fetch logo images ──
  const [tenantLogoImage, customerLogoImage] = await Promise.all([
    fetchLogoImage(tenantLogoUrl, LOGO_DEFAULT),
    fetchLogoImage(finalCustomerLogoUrl, LOGO_DEFAULT),
  ])

  const input: PmCheckReportInput = {
    checkId: check.id,
    siteName,
    jobPlanName,
    checkDate: check.created_at,
    dueDate: check.due_date,
    startedAt: check.started_at,
    completedAt: check.completed_at,
    status: check.status,
    assignedTo: check.assigned_to ? (userMap[check.assigned_to] ?? null) : null,
    tenantProductName: productName,
    primaryColour: primaryColour.replace('#', ''),
    deepColour,
    iceColour,
    inkColour,
    items: reportItems,
    companyName: companyName ?? productName,
    tenantLogoImage: tenantLogoImage ?? null,
    customerLogoImage: customerLogoImage ?? null,
    reportTypeLabel: 'Preventive Maintenance Report',
    maximoWONumber: (check as Record<string, unknown>).maximo_wo_number as string | null,
  }

  // ── Generate DOCX ──
  const docxBuffer = Buffer.from(await generatePMCheckReport(input))

  // ── Compute SHA-256 ──
  const contentHash = createHash('sha256').update(docxBuffer).digest('hex')

  // ── Upload to Supabase Storage ──
  const basePath = `${tenantId}/reports/${maintenanceCheckId}/${revision}`
  const docxPath = `${basePath}.docx`

  const admin = createAdminClient()
  const { error: uploadError } = await admin.storage
    .from('attachments')
    .upload(docxPath, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true, // overwrite if re-run (idempotency)
    })

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`)
  }

  // ── Attempt PDF conversion (graceful — null if no backend configured) ──
  let pdfPath: string | null = null
  try {
    const pdfBuffer = await convertDocxToPdf(docxBuffer)
    if (pdfBuffer) {
      pdfPath = `${basePath}.pdf`
      const { error: pdfUploadError } = await admin.storage
        .from('attachments')
        .upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })
      if (pdfUploadError) {
        console.error('PDF upload failed:', pdfUploadError.message)
        pdfPath = null
      }
    }
  } catch (pdfErr) {
    console.error('PDF conversion failed (non-fatal):', pdfErr)
  }

  return { docxPath, pdfPath, contentHash, docxBuffer }
}

/**
 * Generate a Work Order Details report for a maintenance check, upload to Storage,
 * and return the paths + content hash. One page per asset.
 *
 * Loads check_assets with full WO metadata (priority, work_type, crew_id, etc.)
 * and defects linked to this check, then invokes the work-order-details generator.
 */
export async function generateAndStoreWorkOrderDetailsReport(
  supabase: SupabaseClient,
  tenantId: string,
  maintenanceCheckId: string,
  revision: number,
): Promise<GeneratedReport> {
  // ── Fetch maintenance check ──
  const { data: check, error: checkError } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name, type), sites(name, customer_id)')
    .eq('id', maintenanceCheckId)
    .single()

  if (checkError || !check) {
    throw new Error(`Failed to fetch maintenance check: ${checkError?.message ?? 'not found'}`)
  }

  // ── Fetch customer logo (if site has a customer) ──
  const siteRow = check.sites as { name: string; customer_id?: string | null } | null
  let customerLogoUrl: string | null = null
  if (siteRow?.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('logo_url')
      .eq('id', siteRow.customer_id)
      .maybeSingle()
    customerLogoUrl = customer?.logo_url ?? null
  }

  // ── Fetch check_assets with all Maximo WO fields ──
  const { data: checkAssets, error: assetError } = await supabase
    .from('check_assets')
    .select(`
      id, asset_id, status, work_order_number,
      priority, work_type, crew_id, target_start, target_finish,
      failure_code, problem, cause, remedy, classification, ir_scan_result,
      assets(id, name, location, job_plan_id),
      job_plans:assets(job_plans(name, type))
    `)
    .eq('check_id', maintenanceCheckId)
    .order('created_at', { ascending: true })

  if (assetError || !checkAssets || checkAssets.length === 0) {
    throw new Error(`Failed to fetch check assets: ${assetError?.message ?? 'empty'}`)
  }

  // ── Fetch maintenance_check_items (tasks) for each asset ──
  const assetIds = Array.from(new Set(checkAssets.map((ca) => ca.asset_id).filter(Boolean))) as string[]
  const { data: checkItems, error: itemsError } = await supabase
    .from('maintenance_check_items')
    .select('id, check_asset_id, asset_id, description, result, notes, job_plan_item_id, job_plan_items(maximo_task_id)')
    .eq('check_id', maintenanceCheckId)
    .order('sort_order')

  if (itemsError) {
    throw new Error(`Failed to fetch check items: ${itemsError.message}`)
  }

  // ── Fetch defects linked to this check ──
  // Defects don't have an `is_active` column — they use `status`
  // (open/resolved) and `resolved_at` for soft-delete-equivalent state.
  // CLAUDE.md says "soft delete via is_active everywhere"; defects are
  // the documented exception. (Was throwing 500s on any check with
  // active defects until this was found 2026-04-26.)
  const { data: defectsData, error: defectError } = await supabase
    .from('defects')
    .select('id, code, description, severity, status, wo_number')
    .eq('check_id', maintenanceCheckId)

  if (defectError) {
    console.warn(`Failed to fetch defects: ${defectError.message}`)
  }

  // ── Fetch tenant settings for branding via the cached helper ──
  // report_customer_logo dropped 26-Apr-2026 (audit item 8).
  const tenantSettings = await getCachedTenantSettings(tenantId)

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const deepColour = tenantSettings?.deep_colour ?? null
  const iceColour = tenantSettings?.ice_colour ?? null
  const inkColour = tenantSettings?.ink_colour ?? null
  const companyName = tenantSettings?.report_company_name ?? null
  const reportLogoUrl = tenantSettings?.report_logo_url ?? null

  // ── Fetch tenant for fallback logo ──
  const { data: tenant } = await supabase
    .from('tenants')
    .select('logo_url')
    .eq('id', tenantId)
    .maybeSingle()

  const tenantLogoUrl = reportLogoUrl || tenant?.logo_url || null
  // Customer logo always rendered when present.
  const finalCustomerLogoUrl = customerLogoUrl

  // ── Resolve user display names (for tech capture) ──
  const userIds = Array.from(
    new Set(
      checkAssets
        .map((ca) => (ca as Record<string, unknown>).assigned_to)
        .concat((checkItems ?? []).map((it) => (it as Record<string, unknown>).completed_by))
        .filter(Boolean),
    ),
  ) as string[]

  const userMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      userMap[p.id] = p.full_name ?? p.email
    }
  }

  // ── Fetch logo images ──
  const [tenantLogoImage, customerLogoImage] = await Promise.all([
    fetchLogoImage(tenantLogoUrl, LOGO_DEFAULT),
    fetchLogoImage(finalCustomerLogoUrl, LOGO_DEFAULT),
  ])

  // ── Map check_assets to WorkOrderDetailsAsset ──
  const jobPlanName = (check.job_plans as { name: string } | null)?.name ?? 'Unknown Job Plan'

  const assets: WorkOrderDetailsAsset[] = checkAssets.map((ca) => {
    const asset = ca.assets as { id?: string; name?: string; location?: string | null } | null
    const assetId = asset?.id

    // Collect tasks for this asset
    const assetItems = (checkItems ?? []).filter((it) => it.check_asset_id === ca.id)
    const tasks: WorkOrderTask[] = assetItems.map((it, idx) => {
      const jpItem = Array.isArray(it.job_plan_items) ? it.job_plan_items[0] : (it.job_plan_items as Record<string, unknown> | null)
      const taskId = (
        (jpItem as Record<string, unknown> | null)?.maximo_task_id ??
        null
      ) as string | null

      return {
        taskId: taskId || String(idx + 1),
        description: it.description,
        passed: it.result === 'pass' ? true : it.result === 'fail' ? false : null,
        comments: it.notes ?? null,
      }
    })

    // Collect defects for this asset
    const defects: WorkOrderDefect[] = (defectsData ?? [])
      .filter((d) => (d as Record<string, unknown>).asset_id === assetId)
      .map((d) => ({
        id: d.id,
        code: d.code ?? null,
        description: d.description,
        severity: d.severity ?? null,
        status: d.status ?? null,
        woNumber: d.wo_number ?? null,
      }))

    return {
      assetName: asset?.name ?? 'Unknown Asset',
      location: asset?.location ?? null,
      jobPlanType: jobPlanName,
      maximoWONumber: ca.work_order_number ?? null,
      status: ca.status ?? null,
      workType: ca.work_type ?? null,
      priority: ca.priority ?? null,
      crewId: ca.crew_id ?? null,
      failureCode: ca.failure_code ?? null,
      problem: ca.problem ?? null,
      cause: ca.cause ?? null,
      remedy: ca.remedy ?? null,
      classification: ca.classification ?? null,
      irScanResult: ca.ir_scan_result ?? null,
      targetStart: ca.target_start ?? null,
      targetFinish: ca.target_finish ?? null,
      actualStart: null, // Not in check_assets, left null
      actualFinish: null,
      technicianName: null, // Would need to join on assigned_to if stored
      completedDate: null,
      hoursLogged: null,
      comments: null,
      tasks,
      defects,
    }
  })

  const input: WorkOrderDetailsInput = {
    companyName: companyName ?? productName,
    tenantProductName: productName,
    primaryColour: primaryColour.replace('#', ''),
    deepColour,
    iceColour,
    inkColour,
    tenantLogoImage: tenantLogoImage ?? null,
    customerLogoImage: customerLogoImage ?? null,
    reportTypeLabel: 'Work Order Details',
    assets,
  }

  // ── Generate DOCX ──
  const docxBuffer = Buffer.from(await generateWorkOrderDetailsReport(input))

  // ── Compute SHA-256 ──
  const contentHash = createHash('sha256').update(docxBuffer).digest('hex')

  // ── Upload to Supabase Storage ──
  const basePath = `${tenantId}/reports/${maintenanceCheckId}/${revision}`
  const docxPath = `${basePath}-wo-details.docx`

  const admin = createAdminClient()
  const { error: uploadError } = await admin.storage
    .from('attachments')
    .upload(docxPath, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`)
  }

  // ── Attempt PDF conversion (graceful — null if no backend configured) ──
  let pdfPath: string | null = null
  try {
    const pdfBuffer = await convertDocxToPdf(docxBuffer)
    if (pdfBuffer) {
      pdfPath = `${basePath}-wo-details.pdf`
      const { error: pdfUploadError } = await admin.storage
        .from('attachments')
        .upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })
      if (pdfUploadError) {
        console.error('PDF upload failed:', pdfUploadError.message)
        pdfPath = null
      }
    }
  } catch (pdfErr) {
    console.error('PDF conversion failed (non-fatal):', pdfErr)
  }

  return { docxPath, pdfPath, contentHash, docxBuffer }
}
