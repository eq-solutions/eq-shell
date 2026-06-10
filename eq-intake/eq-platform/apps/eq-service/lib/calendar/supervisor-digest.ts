/**
 * supervisor-digest.ts
 *
 * Orchestrates the daily supervisor digest:
 *
 *   1. List active supervisors per tenant via `list_active_supervisors()`
 *   2. For each supervisor, fetch their entries via
 *      `pm_calendar_for_supervisor(user_id, tenant_id, horizon)`
 *   3. Send one digest email per supervisor via Resend
 *   4. Insert one row per supervisor into `supervisor_digests`
 *
 * Designed to be called from:
 *   - `app/api/cron/supervisor-digest/route.ts` (scheduled, service-role)
 *   - `app/(app)/calendar/actions.ts` admin "Send digest now" action
 *
 * Returns a per-tenant summary so the caller can display results.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendSupervisorDigestEmail,
  type DigestEntry,
  type DigestBucket,
} from '@/lib/email/send-supervisor-digest'

export interface RunSupervisorDigestsOptions {
  /** Days into the future to include in the digest. Default 14. */
  horizonDays?: number
  /** 'cron' or 'manual' — recorded in supervisor_digests.trigger_source */
  triggerSource: 'cron' | 'manual' | 'preview'
  /** Limit to a single tenant (admin "send digest now" use case). */
  tenantId?: string
  /** Limit to a single supervisor user_id. */
  supervisorUserId?: string
  /** Public app URL for "Open calendar" button. */
  appUrl: string
}

export interface SupervisorRunResult {
  tenantId: string
  supervisorUserId: string
  supervisorEmail: string
  supervisorName: string | null
  total: number
  overdue: number
  today: number
  thisWeek: number
  nextWeek: number
  status: 'sent' | 'skipped_empty' | 'skipped_no_email' | 'error' | 'preview'
  error?: string
  resendMessageId?: string
}

interface DbSupervisorRow {
  tenant_id: string
  user_id: string
  email: string
  full_name: string | null
  role: string
}

interface DbCalendarRow {
  id: string
  site_id: string | null
  site_name: string | null
  site_code: string | null
  customer_name: string | null
  title: string
  category: string
  location: string | null
  start_time: string
  end_time: string | null
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  assigned_to: string | null
  assigned_to_name: string | null
  bucket: DigestBucket
}

interface DbTenantRow {
  id: string
  name: string
}

/**
 * Run the digest for all (or some) supervisors. Uses the service-role
 * admin client — caller must enforce auth before invoking.
 */
export async function runSupervisorDigests(
  opts: RunSupervisorDigestsOptions,
): Promise<SupervisorRunResult[]> {
  const horizon = opts.horizonDays ?? 14
  const supabase = createAdminClient()
  const results: SupervisorRunResult[] = []

  // 1. Resolve supervisors via SECURITY DEFINER helper (bypasses RLS via
  //    service role anyway, but keeps the role-filter logic in one place).
  const { data: supervisorsRaw, error: supError } = await supabase.rpc(
    'list_active_supervisors',
  )
  if (supError) {
    throw new Error(`list_active_supervisors failed: ${supError.message}`)
  }
  let supervisors = (supervisorsRaw as DbSupervisorRow[] | null) ?? []
  if (opts.tenantId) supervisors = supervisors.filter((s) => s.tenant_id === opts.tenantId)
  if (opts.supervisorUserId) supervisors = supervisors.filter((s) => s.user_id === opts.supervisorUserId)

  if (supervisors.length === 0) return results

  // 2. Resolve tenant names for the email subject/body.
  const tenantIds = [...new Set(supervisors.map((s) => s.tenant_id))]
  const { data: tenantsRaw } = await supabase
    .from('tenants')
    .select('id, name')
    .in('id', tenantIds)
  const tenantMap = new Map<string, string>(
    ((tenantsRaw as DbTenantRow[] | null) ?? []).map((t) => [t.id, t.name]),
  )

  // 3. Process each supervisor.
  for (const sup of supervisors) {
    const tenantName = tenantMap.get(sup.tenant_id) ?? 'your team'

    let entries: DbCalendarRow[] = []
    try {
      const { data, error } = await supabase.rpc('pm_calendar_for_supervisor', {
        p_supervisor_user_id: sup.user_id,
        p_tenant_id: sup.tenant_id,
        p_horizon_days: horizon,
      })
      if (error) throw error
      entries = (data as DbCalendarRow[] | null) ?? []
    } catch (err) {
      results.push({
        tenantId: sup.tenant_id,
        supervisorUserId: sup.user_id,
        supervisorEmail: sup.email,
        supervisorName: sup.full_name,
        total: 0,
        overdue: 0,
        today: 0,
        thisWeek: 0,
        nextWeek: 0,
        status: 'error',
        error: `pm_calendar_for_supervisor: ${(err as Error).message}`,
      })
      continue
    }

    const counts = {
      overdue: entries.filter((e) => e.bucket === 'overdue').length,
      today: entries.filter((e) => e.bucket === 'today').length,
      thisWeek: entries.filter((e) => e.bucket === 'this_week').length,
      nextWeek: entries.filter((e) => e.bucket === 'next_week').length,
    }

    // Preview mode: don't send, don't log to DB — just return what *would*
    // be sent so an admin can sanity-check.
    if (opts.triggerSource === 'preview') {
      results.push({
        tenantId: sup.tenant_id,
        supervisorUserId: sup.user_id,
        supervisorEmail: sup.email,
        supervisorName: sup.full_name,
        total: entries.length,
        overdue: counts.overdue,
        today: counts.today,
        thisWeek: counts.thisWeek,
        nextWeek: counts.nextWeek,
        status: 'preview',
      })
      continue
    }

    const digestEntries: DigestEntry[] = entries.map((e) => ({
      id: e.id,
      siteName: e.site_name,
      siteCode: e.site_code,
      customerName: e.customer_name,
      title: e.title,
      category: e.category,
      location: e.location,
      startTime: e.start_time,
      endTime: e.end_time,
      status: e.status,
      assignedToName: e.assigned_to_name,
      bucket: e.bucket,
    }))

    let status: SupervisorRunResult['status'] = 'sent'
    let errorMsg: string | undefined
    let resendId: string | undefined

    try {
      const sendRes = await sendSupervisorDigestEmail({
        to: sup.email,
        supervisorName: sup.full_name,
        tenantName,
        appUrl: opts.appUrl,
        generatedAt: new Date().toISOString(),
        entries: digestEntries,
        triggerSource: opts.triggerSource,
      })

      if (sendRes.empty) status = 'skipped_empty'
      else if (sendRes.skipped) status = 'skipped_no_email'
      else resendId = sendRes.resendMessageId
    } catch (err) {
      status = 'error'
      errorMsg = (err as Error).message
    }

    // Audit log — one row per supervisor per send. Always insert (even
    // on skip/error) so absence-of-row means "the cron didn't run" rather
    // than "the cron ran but the supervisor had nothing".
    await supabase.from('supervisor_digests').insert({
      tenant_id: sup.tenant_id,
      supervisor_user_id: sup.user_id,
      supervisor_email: sup.email,
      overdue_count: counts.overdue,
      today_count: counts.today,
      this_week_count: counts.thisWeek,
      next_week_count: counts.nextWeek,
      entry_ids: entries.map((e) => e.id),
      delivery_status: status,
      delivery_error: errorMsg ?? null,
      resend_message_id: resendId ?? null,
      trigger_source: opts.triggerSource,
    })

    results.push({
      tenantId: sup.tenant_id,
      supervisorUserId: sup.user_id,
      supervisorEmail: sup.email,
      supervisorName: sup.full_name,
      total: entries.length,
      overdue: counts.overdue,
      today: counts.today,
      thisWeek: counts.thisWeek,
      nextWeek: counts.nextWeek,
      status,
      error: errorMsg,
      resendMessageId: resendId,
    })
  }

  return results
}
