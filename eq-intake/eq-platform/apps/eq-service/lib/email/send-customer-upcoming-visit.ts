/**
 * send-customer-upcoming-visit.ts
 *
 * Sends a customer-facing "your maintenance visit is in 7 days" email.
 * Fired by the dispatcher cron when a maintenance check has due_date
 * exactly 7 days from today AND a customer contact for that customer
 * has receive_upcoming_visit=true.
 */

import { Resend } from 'resend'
import { buildUnsubscribeUrl } from './unsubscribe-token'

export interface UpcomingVisitEmailInput {
  to: string
  contactName: string | null
  customerName: string
  tenantName: string
  siteName: string
  /** Job plan / scope summary (e.g. 'Annual switchboard maintenance'). */
  visitDescription: string
  visitDate: string  // ISO
  scheduledTimeWindow: string | null  // free-text e.g. '8am - 4pm'
  technicianName: string | null
  portalUrl: string
  /** customer_contact_id — minted into the unsubscribe link. */
  customerContactId?: string
  /** Used to mint the unsubscribe URL — falls back to portalUrl's origin. */
  appUrl?: string
  primaryColour?: string
}

const FROM_ADDRESS = 'EQ Solves Service <contact@eq.solutions>'
const REPLY_TO_ADDRESS = 'contact@eq.solutions'

export async function sendCustomerUpcomingVisitEmail(
  input: UpcomingVisitEmailInput,
): Promise<{ skipped: true } | { id: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping customer upcoming-visit email')
    return { skipped: true }
  }

  const resend = new Resend(apiKey)
  const brand = input.primaryColour || '#3DA8D8'
  const visitDateLabel = new Date(input.visitDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const subject = `Maintenance visit on ${visitDateLabel} — ${input.siteName}`
  const greeting = input.contactName ? `Hi ${input.contactName.split(' ')[0]},` : 'Hello,'

  // AU Spam Act 2003 s18 — functional unsubscribe link.
  let unsubscribeUrl: string | null = null
  if (input.customerContactId) {
    try {
      const appUrl = input.appUrl || new URL(input.portalUrl).origin
      unsubscribeUrl = buildUnsubscribeUrl(appUrl, input.customerContactId, 'upcoming')
    } catch (err) {
      console.warn('[email] unsubscribe link skipped — UNSUBSCRIBE_SECRET missing or bad URL:', (err as Error).message)
    }
  }

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">
    <div style="background: ${brand}; padding: 24px; border-radius: 12px 12px 0 0; color: #fff;">
      <h1 style="font-size: 20px; margin: 0 0 4px; font-weight: 600;">Upcoming Maintenance Visit</h1>
      <p style="font-size: 14px; margin: 0; opacity: 0.9;">${escape(input.customerName)} · ${escape(input.siteName)}</p>
    </div>
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px;">
      <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">${greeting}</p>
      <p style="font-size: 14px; color: #374151; margin: 0 0 20px;">
        ${escape(input.tenantName)} is scheduled to attend ${escape(input.siteName)} for maintenance work.
      </p>

      <!-- Visit details -->
      <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 8px;">
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280; width: 40%;">Date</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827; font-weight: 600;">${visitDateLabel}</td>
        </tr>
        ${input.scheduledTimeWindow ? `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">Time window</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827;">${escape(input.scheduledTimeWindow)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">Site</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827;">${escape(input.siteName)}</td>
        </tr>
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">Scope of work</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827;">${escape(input.visitDescription)}</td>
        </tr>
        ${input.technicianName ? `
        <tr>
          <td style="padding: 12px 16px; font-size: 13px; color: #6b7280;">Lead technician</td>
          <td style="padding: 12px 16px; font-size: 14px; color: #111827;">${escape(input.technicianName)}</td>
        </tr>` : ''}
      </table>

      <p style="font-size: 13px; color: #6b7280; margin: 16px 0;">
        If you need to reschedule, reply to this email or contact your account manager directly.
      </p>

      <div style="text-align: center; margin: 24px 0 8px;">
        <a href="${input.portalUrl}" style="display: inline-block; padding: 12px 28px; background: ${brand}; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">View in portal</a>
      </div>
      ${unsubscribeUrl ? `
      <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 24px 0 0;">
        <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe from upcoming-visit notifications</a>
      </p>` : ''}
    </div>
  </div>
</body></html>
  `.trim()

  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to: input.to,
    replyTo: REPLY_TO_ADDRESS,
    subject,
    html,
  })

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`)
  }
  return { id: result.data?.id ?? 'unknown' }
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
