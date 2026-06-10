/**
 * send-defect-alert.ts
 *
 * Immediate transactional email for newly-raised defects at severity
 * `critical` or `high`. Bypasses the digest cron — the supervisor needs
 * to know within minutes, not at 07:00 tomorrow.
 *
 * Routing rules (kept in lockstep with lib/actions/defect-notifications.ts):
 *   - critical → super_admin + admin + supervisor get email + bell
 *   - high     → super_admin + admin + supervisor get email + bell
 *   - medium / low → bell only (digest picks up later)
 *
 * Each recipient's `email_enabled` preference is checked. Bell rows are
 * always written; the email is the optional add-on.
 */

import { Resend } from 'resend'

export interface DefectAlertEmailInput {
  to: string
  recipientName: string | null
  tenantName: string
  severity: 'critical' | 'high'
  defectTitle: string
  defectDescription: string | null
  siteName: string | null
  assetName: string | null
  raisedBy: string | null
  appUrl: string
  defectId: string
  primaryColour?: string
}

const FROM_ADDRESS = 'EQ Solves Service <contact@eq.solutions>'
const REPLY_TO_ADDRESS = 'contact@eq.solutions'

export async function sendDefectAlertEmail(
  input: DefectAlertEmailInput,
): Promise<{ skipped: true } | { id: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping defect alert email')
    return { skipped: true }
  }

  const resend = new Resend(apiKey)
  const brand = input.primaryColour || '#3DA8D8'
  const sevLabel = input.severity.toUpperCase()
  const sevColour = input.severity === 'critical' ? '#dc2626' : '#ea580c'
  const subject = `[${sevLabel}] Defect: ${input.defectTitle}`
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(' ')[0]},` : 'Hello,'
  const defectUrl = `${input.appUrl}/defects/${input.defectId}`

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">
    <div style="background: ${sevColour}; padding: 24px; border-radius: 12px 12px 0 0; color: #fff;">
      <p style="font-size: 12px; margin: 0 0 4px; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">${sevLabel} severity</p>
      <h1 style="font-size: 20px; margin: 0; font-weight: 600;">Defect raised: ${escape(input.defectTitle)}</h1>
    </div>
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px;">
      <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">${greeting}</p>
      <p style="font-size: 14px; color: #374151; margin: 0 0 20px;">
        A ${sevLabel.toLowerCase()}-severity defect was raised on the ${escape(input.tenantName)} system and needs your attention.
      </p>

      <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 8px;">
        ${input.siteName ? `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280; width: 40%;">Site</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827; font-weight: 600;">${escape(input.siteName)}</td>
        </tr>` : ''}
        ${input.assetName ? `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">Asset</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827;">${escape(input.assetName)}</td>
        </tr>` : ''}
        ${input.raisedBy ? `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">Raised by</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827;">${escape(input.raisedBy)}</td>
        </tr>` : ''}
        ${input.defectDescription ? `
        <tr>
          <td style="padding: 12px 16px; font-size: 13px; color: #6b7280; vertical-align: top;">Description</td>
          <td style="padding: 12px 16px; font-size: 14px; color: #111827; white-space: pre-wrap;">${escape(input.defectDescription)}</td>
        </tr>` : ''}
      </table>

      <div style="text-align: center; margin: 24px 0 8px;">
        <a href="${defectUrl}" style="display: inline-block; padding: 12px 28px; background: ${brand}; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Open defect</a>
      </div>

      <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0; text-align: center;">
        You're receiving this because you're a ${input.severity === 'critical' ? 'super_admin / admin / supervisor' : 'super_admin / admin / supervisor'} on the ${escape(input.tenantName)} tenant and the defect was ${sevLabel.toLowerCase()} severity. Manage notification preferences in app settings.
      </p>
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
