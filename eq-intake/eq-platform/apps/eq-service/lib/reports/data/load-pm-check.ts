/**
 * Data loader for the maintenance-check PDF report.
 *
 * Pulls a check + its assets + tasks-grouped-by-asset + defects + tenant
 * branding into a single shape that the HTML template can render without
 * making any further DB calls. Logo URLs are resolved into base64 data
 * URIs so the rendered HTML is fully self-contained — Gotenberg never has
 * to fetch external assets at render time.
 *
 * RLS-scoped: takes the user's supabase client, so any cross-tenant access
 * is blocked at the policy layer.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLogoImage } from '@/lib/reports/report-branding'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'

export type AssetStatus = 'complete' | 'in_progress' | 'defect' | 'pending'

export interface PmCheckReportTask {
  number: number
  description: string
  result: 'pass' | 'fail' | 'na' | null
  notes: string | null
  completedByName: string | null
  completedAt: string | null
}

export interface PmCheckReportAsset {
  id: string
  name: string
  maximoId: string | null
  location: string | null
  workOrderNumber: string | null
  status: AssetStatus
  tasks: PmCheckReportTask[]
  notes: string | null
  totalTasks: number
  completedTasks: number
  failedTasks: number
  progressPercent: number
  hasDefect: boolean
  defectSummary: string | null
}

export interface PmCheckReportDefect {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical' | null
  status: string
  assetName: string
  description: string
  raisedByName: string | null
  raisedAtFormatted: string
  workOrderNumber: string | null
}

export interface PmCheckReportData {
  check: {
    id: string
    customName: string
    status: string
    startDateFormatted: string | null
    dueDateFormatted: string
    startedAtFormatted: string | null
    completedAtFormatted: string | null
    frequency: string
    notes: string | null
    maximoWONumber: string | null
  }
  site: {
    name: string
    addressLine: string
  }
  customer: {
    name: string
    logoDataUri: string | null
  } | null
  jobPlan: {
    code: string
    name: string
    type: string
  }
  tenant: {
    name: string
    primaryColour: string
    abn: string | null
    headerText: string | null
    footerText: string | null
    logoColourDataUri: string | null
    logoOnDarkDataUri: string | null
  }
  assignedToName: string | null
  assets: PmCheckReportAsset[]
  defects: PmCheckReportDefect[]
  kpi: {
    totalAssets: number
    completedCount: number
    inProgressCount: number
    pendingCount: number
    defectCount: number
  }
  reportDateFormatted: string
  reportPeriodLabel: string
}

export async function loadPmCheckReportData(
  supabase: SupabaseClient,
  tenantId: string,
  checkId: string,
): Promise<PmCheckReportData> {
  // ── Check + site + customer + job plan ──
  const { data: check, error: checkErr } = await supabase
    .from('maintenance_checks')
    .select(`
      id, custom_name, status, start_date, due_date, started_at, completed_at,
      frequency, notes, maximo_wo_number, assigned_to,
      sites(id, name, address, city, state, customer_id, customers(id, name, logo_url)),
      job_plans(id, code, name, type)
    `)
    .eq('id', checkId)
    .single()

  if (checkErr || !check) {
    throw new Error(`Could not load maintenance check: ${checkErr?.message ?? 'not found'}`)
  }

  const site = unwrap<{ id: string; name: string; address: string | null; city: string | null; state: string | null; customer_id: string | null; customers: unknown }>(check.sites)
  const customerRow = site ? unwrap<{ id: string; name: string; logo_url: string | null }>(site.customers) : null
  const jobPlan = unwrap<{ id: string; code: string; name: string; type: string }>(check.job_plans)

  // ── check_assets joined with assets ──
  const { data: checkAssets, error: caErr } = await supabase
    .from('check_assets')
    .select(`
      id, asset_id, status, work_order_number, notes,
      problem, cause, remedy,
      assets(id, name, maximo_id, location)
    `)
    .eq('check_id', checkId)
    .order('created_at', { ascending: true })

  if (caErr) throw new Error(`Could not load check assets: ${caErr.message}`)

  // ── tasks (maintenance_check_items) ──
  const { data: items, error: itemsErr } = await supabase
    .from('maintenance_check_items')
    .select('id, check_asset_id, description, result, notes, completed_by, completed_at, sort_order')
    .eq('check_id', checkId)
    .order('sort_order', { ascending: true })

  if (itemsErr) throw new Error(`Could not load check items: ${itemsErr.message}`)

  // ── defects ──
  // No is_active column on defects — they're tracked via `status`
  // (open/resolved) and `resolved_at`. Pull all defects for the check;
  // the template will badge them by status.
  const { data: defects, error: defErr } = await supabase
    .from('defects')
    .select('id, check_asset_id, severity, status, title, description, raised_by, work_order_number, created_at, asset_id')
    .eq('check_id', checkId)
    .order('created_at', { ascending: true })

  if (defErr) throw new Error(`Could not load defects: ${defErr.message}`)

  // ── tenant settings via cached helper + tenant ──
  const settings = await getCachedTenantSettings(tenantId)

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name, logo_url')
    .eq('id', tenantId)
    .maybeSingle()

  // The on-dark logo lives on tenant_settings via the column added by
  // migration 0040+ (per ReportSettingsForm). It might be missing on older
  // tenants — read defensively.
  const settingsAny = settings as unknown as Record<string, string | null> | null
  const logoOnDarkUrl = settingsAny?.report_logo_url_on_dark ?? null

  // ── Resolve user names referenced by assigned_to / completed_by / raised_by ──
  const userIds = unique([
    check.assigned_to as string | null,
    ...(items ?? []).map((i) => i.completed_by as string | null),
    ...(defects ?? []).map((d) => d.raised_by as string | null),
  ])

  const userMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      userMap.set(p.id, p.full_name ?? p.email)
    }
  }

  // ── Fetch logos as data URIs (parallel) ──
  const tenantLogoColourUrl = settings?.report_logo_url ?? tenantRow?.logo_url ?? null
  const customerLogoUrl = customerRow?.logo_url ?? null

  const [logoColour, logoOnDark, customerLogo] = await Promise.all([
    fetchAsDataUri(tenantLogoColourUrl, { maxWidth: 240, maxHeight: 80 }),
    fetchAsDataUri(logoOnDarkUrl, { maxWidth: 280, maxHeight: 100 }),
    fetchAsDataUri(customerLogoUrl, { maxWidth: 220, maxHeight: 80 }),
  ])

  // ── Assemble assets with their tasks ──
  const assetsList: PmCheckReportAsset[] = (checkAssets ?? []).map((ca) => {
    const asset = unwrap<{ id: string; name: string; maximo_id: string | null; location: string | null }>(ca.assets)
    const myTasks = (items ?? []).filter((it) => it.check_asset_id === ca.id)
    const myDefects = (defects ?? []).filter((d) => d.check_asset_id === ca.id)
    const completed = myTasks.filter((t) => t.result === 'pass' || t.result === 'fail' || t.result === 'na').length
    const failed = myTasks.filter((t) => t.result === 'fail').length
    const total = myTasks.length
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0
    const hasDefect = myDefects.length > 0

    let status: AssetStatus = 'pending'
    if (hasDefect) status = 'defect'
    else if (completed === total && total > 0) status = 'complete'
    else if (completed > 0) status = 'in_progress'

    return {
      id: asset?.id ?? ca.asset_id ?? ca.id,
      name: asset?.name ?? 'Unknown asset',
      maximoId: asset?.maximo_id ?? null,
      location: asset?.location ?? null,
      workOrderNumber: ca.work_order_number ?? null,
      status,
      tasks: myTasks.map((it, idx) => ({
        number: idx + 1,
        description: it.description as string,
        result: it.result as 'pass' | 'fail' | 'na' | null,
        notes: (it.notes as string | null) ?? null,
        completedByName: it.completed_by ? userMap.get(it.completed_by as string) ?? null : null,
        completedAt: (it.completed_at as string | null) ?? null,
      })),
      notes: (ca.notes as string | null) ?? null,
      totalTasks: total,
      completedTasks: completed,
      failedTasks: failed,
      progressPercent,
      hasDefect,
      defectSummary: hasDefect ? (myDefects[0].description as string) : null,
    }
  })

  // ── Asset name lookup for defects table ──
  const assetNameById = new Map<string, string>()
  for (const ca of checkAssets ?? []) {
    const asset = unwrap<{ id: string; name: string }>(ca.assets)
    if (asset?.id) assetNameById.set(asset.id, asset.name)
  }

  const defectsList: PmCheckReportDefect[] = (defects ?? []).map((d) => ({
    id: d.id as string,
    severity: (d.severity as PmCheckReportDefect['severity']) ?? null,
    status: (d.status as string) ?? 'open',
    assetName: assetNameById.get(d.asset_id as string) ?? '—',
    description: (d.description as string) ?? (d.title as string) ?? '',
    raisedByName: d.raised_by ? userMap.get(d.raised_by as string) ?? null : null,
    raisedAtFormatted: formatDate(d.created_at as string),
    workOrderNumber: (d.work_order_number as string | null) ?? null,
  }))

  // ── KPIs ──
  const kpi = {
    totalAssets: assetsList.length,
    completedCount: assetsList.filter((a) => a.status === 'complete').length,
    inProgressCount: assetsList.filter((a) => a.status === 'in_progress').length,
    pendingCount: assetsList.filter((a) => a.status === 'pending').length,
    defectCount: assetsList.filter((a) => a.status === 'defect').length,
  }

  return {
    check: {
      id: check.id as string,
      customName: (check.custom_name as string) ?? `${jobPlan?.name ?? 'Check'} — ${site?.name ?? ''}`,
      status: check.status as string,
      startDateFormatted: check.start_date ? formatDate(check.start_date as string) : null,
      dueDateFormatted: formatDate(check.due_date as string),
      startedAtFormatted: check.started_at ? formatDate(check.started_at as string) : null,
      completedAtFormatted: check.completed_at ? formatDate(check.completed_at as string) : null,
      frequency: (check.frequency as string) ?? '—',
      notes: (check.notes as string | null) ?? null,
      maximoWONumber: (check.maximo_wo_number as string | null) ?? null,
    },
    site: {
      name: site?.name ?? 'Unknown site',
      addressLine: [site?.address, site?.city, site?.state].filter(Boolean).join(', ') || '—',
    },
    customer: customerRow
      ? { name: customerRow.name, logoDataUri: customerLogo }
      : null,
    jobPlan: {
      code: jobPlan?.code ?? '',
      name: jobPlan?.name ?? '',
      type: jobPlan?.type ?? '',
    },
    tenant: {
      name: settings?.report_company_name ?? tenantRow?.name ?? 'EQ Solves',
      primaryColour: settings?.primary_colour ?? '#3DA8D8',
      abn: settings?.report_company_abn ?? null,
      headerText: (settings as { report_header_text?: string | null } | null)?.report_header_text ?? null,
      footerText: (settings as { report_footer_text?: string | null } | null)?.report_footer_text ?? null,
      logoColourDataUri: logoColour,
      logoOnDarkDataUri: logoOnDark,
    },
    assignedToName: check.assigned_to ? userMap.get(check.assigned_to as string) ?? null : null,
    assets: assetsList,
    defects: defectsList,
    kpi,
    reportDateFormatted: formatDate(new Date().toISOString()),
    reportPeriodLabel: monthYearLabel(check.due_date as string),
  }
}

// ───────── helpers ─────────

function unwrap<T>(maybe: unknown): T | null {
  if (!maybe) return null
  if (Array.isArray(maybe)) return (maybe[0] as T) ?? null
  return maybe as T
}

function unique(arr: (string | null | undefined)[]): string[] {
  const set = new Set<string>()
  for (const v of arr) if (v) set.add(v)
  return Array.from(set)
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}

function monthYearLabel(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

async function fetchAsDataUri(
  url: string | null,
  opts: { maxWidth: number; maxHeight: number },
): Promise<string | null> {
  if (!url) return null
  const img = await fetchLogoImage(url, opts)
  if (!img) return null
  const mime = img.type === 'png' ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${img.data.toString('base64')}`
}
