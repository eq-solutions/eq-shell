// Scheduled daily briefing — fires at 09:00 UTC (7pm AEST = morning briefing).
//
// Reads shell_control.tenants for rows with a non-null brief_recipients array,
// generates the AI briefing for each tenant, and sends branded HTML email via Resend.
//
// Config column brief_recipients TEXT[] lives on shell_control.tenants (jvkn
// control plane, NOT the One Pipe — control-plane DDL is applied directly via MCP).
//
// To opt a tenant in: add email address(es) to brief_recipients on that tenant row.
// To opt out: set brief_recipients = NULL (or remove all emails).

import { getServiceClient } from './_shared/supabase.js';
import { sendEmail } from './_shared/email.js';
import { generateBrief, type FullBriefingResponse } from './_shared/briefing-engine.js';
import { captureServerError } from './_shared/sentry.js';

export const config = { schedule: '0 9 * * *' };  // 09:00 UTC = 7pm AEST

// ── Brand constants ───────────────────────────────────────────────────────────

const EQ_SKY  = '#3DA8D8';
const EQ_DEEP = '#2986B4';
const EQ_ICE  = '#EAF5FB';
const EQ_INK  = '#1A1A2E';

// ── Email renderer ────────────────────────────────────────────────────────────

const URGENCY_COLOUR: Record<string, string> = {
  critical: '#DC2626',
  high:     '#D97706',
  normal:   EQ_SKY,
};

const APP_LABELS: Record<string, string> = {
  field:   'EQ Field',
  service: 'EQ Service',
  quotes:  'EQ Quotes',
  ops:     'EQ Ops',
  cards:   'EQ Cards',
};

function renderBriefingEmail(brief: FullBriefingResponse, tenantName: string): { subject: string; html: string; text: string } {
  const dateStr = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });
  const subject = `${tenantName} briefing — ${dateStr}`;

  const actionsHtml = brief.actions.length > 0
    ? brief.actions.map(a => {
        const colour  = URGENCY_COLOUR[a.urgency] ?? EQ_SKY;
        const appLabel = a.app_link ? (APP_LABELS[a.app_link] ?? a.app_link) : a.source;
        const deadline = a.deadline ? `<span style="color:#6B7280;font-size:12px;"> · ${a.deadline}</span>` : '';
        return `
          <tr>
            <td style="padding:10px 16px;border-bottom:1px solid #E5E7EB;vertical-align:top;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colour};margin-right:8px;vertical-align:middle;"></span>
              <span style="font-weight:600;color:${EQ_INK};">${a.title}</span>${deadline}
              <br><span style="font-size:12px;color:#6B7280;margin-left:16px;">${appLabel}</span>
            </td>
          </tr>`;
      }).join('')
    : '<tr><td style="padding:10px 16px;color:#6B7280;">No priority actions.</td></tr>';

  const onShiftHtml = brief.on_shift.length > 0
    ? brief.on_shift.map(s => {
        const where = s.site ? ` · ${s.site}` : '';
        const since = s.since ? ` (from ${s.since})` : '';
        return `<li style="margin:2px 0;color:${EQ_INK};">${s.name}${where}${since}</li>`;
      }).join('')
    : `<li style="color:#6B7280;">No shift data.</li>`;

  const sourceBadges = brief.contributing_sources.length > 0
    ? brief.contributing_sources.map(s =>
        `<span style="display:inline-block;background:${EQ_ICE};color:${EQ_DEEP};border-radius:4px;padding:2px 8px;font-size:11px;margin:2px;">${s}</span>`
      ).join(' ')
    : '';

  const degradedNote = brief.degraded.length > 0
    ? `<p style="font-size:12px;color:#D97706;margin-top:8px;">Data partially unavailable: ${brief.degraded.join(', ')}.</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:${EQ_INK};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:${EQ_INK};padding:24px 32px;">
          <span style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.5px;">EQ</span>
          <span style="font-size:20px;font-weight:400;color:${EQ_SKY};"> · Daily Briefing</span>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:13px;">${dateStr} · ${tenantName}</p>
        </td></tr>

        <!-- Brief -->
        <tr><td style="padding:24px 32px;background:${EQ_ICE};border-bottom:1px solid #D0EBF7;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:${EQ_INK};">${brief.brief ?? 'No operational summary available.'}</p>
          ${degradedNote}
        </td></tr>

        <!-- Priority Actions -->
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0 0 12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;">Priority Actions</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
            ${actionsHtml}
          </table>
        </td></tr>

        <!-- On Shift -->
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;">On Shift</p>
          <ul style="margin:0;padding-left:20px;line-height:1.8;">${onShiftHtml}</ul>
          ${brief.shift_scheduled_count !== null
            ? `<p style="margin:6px 0 0;font-size:12px;color:#6B7280;">${brief.shift_scheduled_count} scheduled today.</p>`
            : ''}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 32px;border-top:1px solid #E5E7EB;margin-top:20px;">
          ${sourceBadges ? `<p style="margin:0 0 8px;font-size:11px;color:#9CA3AF;">Sources: ${sourceBadges}</p>` : ''}
          <p style="margin:0;font-size:11px;color:#9CA3AF;">
            Generated ${new Date(brief.generated_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} AEST.
            Log in to <a href="https://core.eq.solutions" style="color:${EQ_DEEP};text-decoration:none;">EQ</a> to action items.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `EQ Daily Briefing — ${dateStr} — ${tenantName}`,
    '',
    brief.brief ?? 'No summary.',
    '',
    '── PRIORITY ACTIONS ──',
    ...(brief.actions.length > 0
      ? brief.actions.map(a => `${a.rank}. [${a.urgency.toUpperCase()}] ${a.title}${a.deadline ? ' · ' + a.deadline : ''}`)
      : ['No priority actions.']),
    '',
    '── ON SHIFT ──',
    ...(brief.on_shift.length > 0
      ? brief.on_shift.map(s => `${s.name}${s.site ? ' @ ' + s.site : ''}${s.since ? ' from ' + s.since : ''}`)
      : ['No shift data.']),
    '',
    `Log in: https://core.eq.solutions`,
  ].join('\n');

  return { subject, html, text };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function scheduledBriefing(): Promise<void> {
  const shared = getServiceClient();

  // Fetch all tenants opted into email briefings
  const { data: tenants, error } = await shared
    .from('tenants')
    .select('id, name, brief_recipients')
    .not('brief_recipients', 'is', null)
    .eq('active', true);

  if (error) {
    console.error('[scheduled-briefing] failed to fetch tenants:', error.message);
    captureServerError(error, { context: 'scheduled-briefing:tenants' });
    return;
  }

  const rows = (tenants ?? []) as Array<{ id: string; name: string | null; brief_recipients: string[] }>;
  const eligible = rows.filter(r => r.brief_recipients?.length > 0);

  if (eligible.length === 0) {
    console.log('[scheduled-briefing] no tenants opted in, skipping');
    return;
  }

  console.log(`[scheduled-briefing] generating for ${eligible.length} tenant(s)`);

  await Promise.allSettled(eligible.map(async (tenant) => {
    const tenantName = tenant.name ?? tenant.id;
    try {
      const brief = await generateBrief(tenant.id);
      const { subject, html, text } = renderBriefingEmail(brief, tenantName);

      await Promise.allSettled(
        tenant.brief_recipients.map(to =>
          sendEmail({ to, subject, html, text })
            .then(r => {
              if (!r.delivered) {
                console.warn(`[scheduled-briefing] delivery failed to ${to}:`, r.reason);
              } else {
                console.log(`[scheduled-briefing] sent to ${to} (${r.messageId})`);
              }
            })
        )
      );
    } catch (e) {
      captureServerError(e, { context: 'scheduled-briefing:tenant', tenantId: tenant.id });
      console.error(`[scheduled-briefing] failed for tenant ${tenantName}:`, (e as Error).message);
    }
  }));

  console.log('[scheduled-briefing] done');
}
