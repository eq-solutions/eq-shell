/**
 * send-report-email.ts
 *
 * Sends a report delivery email via Resend.
 * If RESEND_API_KEY is not set, logs a warning and returns silently
 * (graceful degradation — the report is still generated and stored).
 */

import { Resend } from 'resend'

export interface ReportDeliveryEmailInput {
  to: string[]
  cc?: string[]
  checkName: string
  customerName: string
  siteName: string
  revision: number
  revisionReason?: string
  message?: string
  docxUrl: string
  pdfUrl?: string | null
  expiresAt: string
  contentHash: string
}

const FROM_ADDRESS = 'EQ Solves Service <contact@eq.solutions>'
const REPLY_TO_ADDRESS = 'contact@eq.solutions'

export async function sendReportDeliveryEmail(input: ReportDeliveryEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping report delivery email')
    return
  }

  const resend = new Resend(apiKey)

  const expiryDate = new Date(input.expiresAt).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const revisionLine = input.revision > 1
    ? `<p style="color: #b45309; font-size: 14px; margin: 12px 0;">⚠️ This is <strong>Revision ${input.revision}</strong>${input.revisionReason ? ` — ${input.revisionReason}` : ''}. It supersedes all previous versions.</p>`
    : ''

  const messageLine = input.message
    ? `<div style="background: #f8f9fa; border-left: 3px solid #3DA8D8; padding: 12px 16px; margin: 16px 0; font-size: 14px; color: #374151;">${input.message}</div>`
    : ''

  const downloadButtons = [
    `<a href="${input.docxUrl}" style="display: inline-block; padding: 10px 24px; background: #3DA8D8; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; margin-right: 12px;">Download Word Document</a>`,
    input.pdfUrl
      ? `<a href="${input.pdfUrl}" style="display: inline-block; padding: 10px 24px; background: #1e3a5f; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Download PDF</a>`
      : '',
  ].filter(Boolean).join('\n')

  const subject = input.revision > 1
    ? `Maintenance Report (Rev ${input.revision}) — ${input.checkName}`
    : `Maintenance Report — ${input.checkName}`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-block; width: 40px; height: 40px; background: #3DA8D8; border-radius: 8px; line-height: 40px; color: #fff; font-weight: bold; font-size: 16px;">EQ</div>
    </div>

    <!-- Card -->
    <div style="background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="font-size: 20px; color: #111827; margin: 0 0 8px;">Maintenance Report</h1>
      <p style="font-size: 14px; color: #6b7280; margin: 0 0 20px;">Your maintenance report is ready for download.</p>

      ${revisionLine}
      ${messageLine}

      <!-- Details -->
      <table style="width: 100%; font-size: 14px; color: #374151; margin: 16px 0; border-collapse: collapse;">
        <tr><td style="padding: 6px 0; color: #6b7280; width: 120px;">Report</td><td style="padding: 6px 0; font-weight: 600;">${input.checkName}</td></tr>
        ${input.customerName ? `<tr><td style="padding: 6px 0; color: #6b7280;">Customer</td><td style="padding: 6px 0;">${input.customerName}</td></tr>` : ''}
        ${input.siteName ? `<tr><td style="padding: 6px 0; color: #6b7280;">Site</td><td style="padding: 6px 0;">${input.siteName}</td></tr>` : ''}
      </table>

      <!-- Download buttons -->
      <div style="margin: 24px 0; text-align: center;">
        ${downloadButtons}
      </div>

      <!-- Expiry + hash -->
      <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 24px;">
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          Download links expire on ${expiryDate}.<br>
          Content hash: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${input.contentHash.slice(0, 16)}</code>
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 24px;">
      <p style="font-size: 12px; color: #9ca3af;">
        Sent by EQ Solutions · <a href="https://eq.solutions" style="color: #3DA8D8; text-decoration: none;">eq.solutions</a>
      </p>
    </div>
  </div>
</body>
</html>`

  await resend.emails.send({
    from: FROM_ADDRESS,
    replyTo: REPLY_TO_ADDRESS,
    to: input.to,
    cc: input.cc?.length ? input.cc : undefined,
    subject,
    html,
  })
}
