/**
 * send-supervisor-digest.ts
 *
 * Sends the daily/weekly supervisor digest email via Resend.
 *
 * Same graceful-degradation pattern as send-report-email: if RESEND_API_KEY
 * is missing the helper returns `{ skipped: true }` and the caller logs
 * `delivery_status='skipped_no_email'` to supervisor_digests so the
 * audit trail still shows we tried.
 *
 * Returns either `{ skipped: true }` or `{ id: string }` (Resend message
 * id) for the audit log. Throws on Resend API errors so the caller can
 * record `delivery_status='error'` with the message.
 */

import { Resend } from 'resend'

export type DigestBucket = 'overdue' | 'today' | 'this_week' | 'next_week'

export interface DigestEntry {
  id: string
  siteName: string | null
  siteCode: string | null
  customerName: string | null
  title: string
  category: string
  location: string | null
  startTime: string  // ISO
  endTime: string | null
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  assignedToName: string | null
  bucket: DigestBucket
}

export interface SupervisorDigestEmailInput {
  to: string
  supervisorName: string | null
  tenantName: string
  /** Used for "View in calendar" CTA. e.g. https://app.eq.solutions */
  appUrl: string
  generatedAt: string  // ISO
  entries: DigestEntry[]
  /** Trigger source for footer disclosure ('cron' = scheduled, 'manual' = admin-triggered). */
  triggerSource: 'cron' | 'manual'
}

export interface SupervisorDigestSendResult {
  skipped: boolean
  resendMessageId?: string
  /** True when there were no entries to send — caller should log
   * `skipped_empty` rather than send an empty email. */
  empty: boolean
}

const FROM_ADDRESS = 'EQ Solves Service <contact@eq.solutions>'
const REPLY_TO_ADDRESS = 'contact@eq.solutions'

const BUCKET_LABEL: Record<DigestBucket, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  this_week: 'This week',
  next_week: 'Next 7–14 days',
}

const BUCKET_BG: Record<DigestBucket, string> = {
  overdue: '#fee2e2',
  today: '#fef3c7',
  this_week: '#dbeafe',
  next_week: '#f3f4f6',
}

const BUCKET_FG: Record<DigestBucket, string> = {
  overdue: '#991b1b',
  today: '#92400e',
  this_week: '#1e3a8a',
  next_week: '#374151',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function escape(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderBucket(bucket: DigestBucket, entries: DigestEntry[], appUrl: string): string {
  if (entries.length === 0) return ''

  const rows = entries
    .map((e) => {
      const siteLabel = e.siteCode
        ? `${escape(e.siteCode)} · ${escape(e.siteName)}`
        : escape(e.siteName)
      const customerSuffix = e.customerName ? ` <span style="color:#9ca3af;">· ${escape(e.customerName)}</span>` : ''
      const dateLabel = `${fmtDate(e.startTime)} ${fmtTime(e.startTime)}`
      const assignee = e.assignedToName
        ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">Assigned: ${escape(e.assignedToName)}</div>`
        : `<div style="font-size:11px;color:#dc2626;margin-top:2px;">Unassigned</div>`
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px;">
            <div style="font-weight:600;color:#111827;">${escape(e.title)}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">${siteLabel}${customerSuffix}</div>
            ${assignee}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:12px;color:#374151;white-space:nowrap;">
            <div>${escape(e.category)}</div>
            <div style="margin-top:2px;color:#6b7280;">${dateLabel}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:right;">
            <a href="${appUrl}/calendar?focus=${e.id}" style="font-size:12px;color:#3DA8D8;text-decoration:none;">Open →</a>
          </td>
        </tr>`
    })
    .join('')

  return `
    <div style="margin-top:20px;">
      <div style="display:inline-block;padding:4px 10px;background:${BUCKET_BG[bucket]};color:${BUCKET_FG[bucket]};border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">
        ${BUCKET_LABEL[bucket]} · ${entries.length}
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

export async function sendSupervisorDigestEmail(
  input: SupervisorDigestEmailInput,
): Promise<SupervisorDigestSendResult> {
  if (input.entries.length === 0) {
    return { skipped: true, empty: true }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping supervisor digest email')
    return { skipped: true, empty: false }
  }

  const buckets: DigestBucket[] = ['overdue', 'today', 'this_week', 'next_week']
  const grouped = Object.fromEntries(
    buckets.map((b) => [b, input.entries.filter((e) => e.bucket === b)]),
  ) as Record<DigestBucket, DigestEntry[]>

  const counts = {
    overdue: grouped.overdue.length,
    today: grouped.today.length,
    this_week: grouped.this_week.length,
    next_week: grouped.next_week.length,
  }

  const resend = new Resend(apiKey)

  const summaryLine = [
    counts.overdue > 0 ? `${counts.overdue} overdue` : null,
    counts.today > 0 ? `${counts.today} today` : null,
    counts.this_week > 0 ? `${counts.this_week} this week` : null,
    counts.next_week > 0 ? `${counts.next_week} next 7–14 days` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const subjectLead =
    counts.overdue > 0
      ? `[${counts.overdue} overdue] `
      : counts.today > 0
        ? `[${counts.today} due today] `
        : ''

  const subject = `${subjectLead}PM digest — ${fmtDate(input.generatedAt)}`

  const greetName = input.supervisorName?.split(' ')[0] || 'there'

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="display:inline-block;width:40px;height:40px;background:#3DA8D8;border-radius:8px;line-height:40px;color:#fff;font-weight:bold;font-size:16px;">EQ</div>
    </div>

    <div style="background:#ffffff;border-radius:12px;padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="font-size:18px;color:#111827;margin:0 0 4px;">PM digest for ${escape(input.tenantName)}</h1>
      <p style="font-size:13px;color:#6b7280;margin:0 0 4px;">Hi ${escape(greetName)} — here's your scheduled-maintenance snapshot for ${fmtDate(input.generatedAt)}.</p>
      <p style="font-size:12px;color:#9ca3af;margin:0;">${summaryLine}</p>

      ${renderBucket('overdue', grouped.overdue, input.appUrl)}
      ${renderBucket('today', grouped.today, input.appUrl)}
      ${renderBucket('this_week', grouped.this_week, input.appUrl)}
      ${renderBucket('next_week', grouped.next_week, input.appUrl)}

      <div style="margin-top:28px;text-align:center;">
        <a href="${input.appUrl}/calendar" style="display:inline-block;padding:10px 24px;background:#3DA8D8;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Open calendar</a>
      </div>
    </div>

    <div style="text-align:center;margin-top:20px;">
      <p style="font-size:11px;color:#9ca3af;margin:0;">
        ${input.triggerSource === 'cron' ? 'Sent automatically by EQ Solutions.' : 'Sent on-demand by an admin.'}
        <br>
        <a href="${input.appUrl}/calendar" style="color:#3DA8D8;text-decoration:none;">${input.appUrl.replace(/^https?:\/\//, '')}</a>
      </p>
    </div>
  </div>
</body>
</html>`

  const res = await resend.emails.send({
    from: FROM_ADDRESS,
    replyTo: REPLY_TO_ADDRESS,
    to: [input.to],
    subject,
    html,
  })

  // Resend SDK returns { data, error } in newer versions. Throw on error so
  // caller logs delivery_status='error'.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = res as any
  if (r?.error) {
    throw new Error(`Resend send failed: ${r.error.message ?? JSON.stringify(r.error)}`)
  }

  const messageId: string | undefined = r?.data?.id ?? r?.id
  return { skipped: false, empty: false, resendMessageId: messageId }
}
