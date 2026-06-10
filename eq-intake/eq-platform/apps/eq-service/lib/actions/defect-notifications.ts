'use server'

import { createNotification } from '@/lib/actions/notifications'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { sendDefectAlertEmail } from '@/lib/email/send-defect-alert'

/**
 * Fan-out notifications when a defect is raised.
 *
 * Recipient policy:
 *   - severity='critical' → super_admin + admin + supervisor (bell + immediate email)
 *   - severity='high'     → super_admin + admin + supervisor (bell + immediate email)
 *   - severity='medium'   → admin + supervisor              (bell only; digest later)
 *   - severity='low'      → admin + supervisor              (bell only; digest later)
 *
 * Critical and high get an immediate transactional email because the
 * supervisor needs to know within minutes, not at the next 07:00 digest
 * slot. Medium / low ride the digest — they're not safety-of-life issues.
 *
 * Per-recipient email_enabled preference is honoured: a user with email
 * off still gets the bell, but no inbox alert.
 *
 * Errors are swallowed — defect creation must not be blocked by a
 * notification failure. Used by:
 *   - app/(app)/maintenance/actions.ts → raiseDefectAction
 *   - app/(app)/acb-testing/actions.ts → raiseDefectFromAcbAction
 *   - app/(app)/nsx-testing/actions.ts → raiseDefectFromNsxAction
 */
export async function notifyDefectRaised(opts: {
  tenantId: string
  defectId: string
  title: string
  description?: string | null
  severity: string
}) {
  try {
    const isHighOrCritical = opts.severity === 'critical' || opts.severity === 'high'
    const recipientRoles: string[] = isHighOrCritical
      ? ['super_admin', 'admin', 'supervisor']
      : ['admin', 'supervisor']

    // We use the admin client to fan-out — these notifications are
    // system-generated, not user-attributable. The notifications RLS
    // policy 'Service can insert notifications' allows service-role
    // insertion.
    const supabase = createAdminClient()
    const { data: memberships } = await supabase
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', opts.tenantId)
      .eq('is_active', true)
      .in('role', recipientRoles)

    const memberIds = (memberships ?? []).map((m) => m.user_id as string)
    const profileById = new Map<string, { full_name: string | null; email: string | null }>()
    if (memberIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', memberIds)
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
        profileById.set(p.id, { full_name: p.full_name, email: p.email })
      }
    }

    const sevLabel = opts.severity === 'critical'
      ? 'CRITICAL'
      : (opts.severity ?? 'medium').toUpperCase()

    // For high/critical, hydrate the email context once (site + asset
    // + raiser names + tenant brand). Skipped for medium/low — we don't
    // need them since no email goes out.
    let tenantName = 'EQ Solves Service'
    let primaryColour: string | undefined
    let siteName: string | null = null
    let assetName: string | null = null
    let raisedByName: string | null = null
    if (isHighOrCritical) {
      // Tenant settings via cached helper; defect join in parallel.
      const [ts, defectRes] = await Promise.all([
        getCachedTenantSettings(opts.tenantId),
        supabase
          .from('defects')
          .select('raised_by, sites(name), assets(name)')
          .eq('id', opts.defectId)
          .maybeSingle(),
      ])
      if (ts) {
        tenantName = ts.report_company_name ?? ts.product_name ?? tenantName
        primaryColour = ts.primary_colour ?? undefined
      }
      if (defectRes.data) {
        type DefectJoin = {
          raised_by: string | null
          sites: { name?: string } | { name?: string }[] | null
          assets: { name?: string } | { name?: string }[] | null
        }
        const d = defectRes.data as DefectJoin
        const site = Array.isArray(d.sites) ? d.sites[0] : d.sites
        const asset = Array.isArray(d.assets) ? d.assets[0] : d.assets
        siteName = site?.name ?? null
        assetName = asset?.name ?? null
        // defects.raised_by FKs to auth.users, not profiles — second
        // lookup against profiles keyed by user id.
        if (d.raised_by) {
          const { data: raiserProf } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', d.raised_by)
            .maybeSingle()
          raisedByName = (raiserProf as { full_name?: string | null } | null)?.full_name ?? null
        }
      }
    }

    const appUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://eq-solves-service.netlify.app'

    for (const userId of memberIds) {
      // Bell — always.
      await createNotification({
        tenantId: opts.tenantId,
        userId,
        type: 'defect_raised',
        title: `[${sevLabel}] Defect raised: ${opts.title}`,
        body: opts.description ?? undefined,
        entityType: 'defect',
        entityId: opts.defectId,
      })

      // Immediate email — critical + high only, and only if the user
      // hasn't disabled email globally.
      if (!isHighOrCritical) continue

      const prof = profileById.get(userId)
      const recipientEmail = prof?.email ?? null
      if (!recipientEmail) continue

      // Per-user email_enabled check — get_effective_notification_prefs
      // returns the merged tenant→user prefs row.
      const { data: prefRows } = await supabase
        .rpc('get_effective_notification_prefs', {
          p_tenant_id: opts.tenantId,
          p_user_id: userId,
        })
      const prefs = (prefRows ?? [])[0] as { email_enabled?: boolean } | undefined
      if (prefs && prefs.email_enabled === false) continue

      try {
        await sendDefectAlertEmail({
          to: recipientEmail,
          recipientName: prof?.full_name ?? null,
          tenantName,
          severity: opts.severity as 'critical' | 'high',
          defectTitle: opts.title,
          defectDescription: opts.description ?? null,
          siteName,
          assetName,
          raisedBy: raisedByName,
          appUrl,
          defectId: opts.defectId,
          primaryColour,
        })
      } catch (emailErr) {
        // Email failure must not break bell delivery. Log and continue.
        console.error(`[defect-notifications] email send failed for ${recipientEmail}:`, emailErr)
      }
    }
  } catch {
    // Quiet — never block the defect creation.
  }
}
