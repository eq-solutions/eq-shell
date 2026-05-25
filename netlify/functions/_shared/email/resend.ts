// Resend provider for the EQ Shell email helper.
//
// Uses the Resend REST API directly — no SDK dependency — so there is
// nothing to install and the cold-start overhead is zero.
//
// Required env vars (set on the Netlify project, never in source):
//   RESEND_API_KEY   — the re_xxx key from resend.com/api-keys
//   EMAIL_FROM       — sender identity, e.g. "EQ Solutions <noreply@eq.solutions>"
//                      Defaults to "EQ Solutions <noreply@eq.solutions>" if unset.
//
// Resend API reference: https://resend.com/docs/api-reference/emails/send-email

import type { EmailMessage, EmailResult } from '../email.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM    = 'EQ Solutions <noreply@eq.solutions>';

interface ResendSuccessBody { id: string }
interface ResendErrorBody   { name: string; message: string; statusCode: number }

export async function sendViaResend(msg: EmailMessage): Promise<EmailResult> {
  const apiKey  = process.env.RESEND_API_KEY;
  const from    = (process.env.EMAIL_FROM ?? DEFAULT_FROM).trim();

  if (!apiKey) {
    console.error('[email/resend] RESEND_API_KEY not set — falling back to log-only');
    return { delivered: false, messageId: null, reason: 'RESEND_API_KEY not configured' };
  }

  const payload: Record<string, unknown> = {
    from,
    to:      [msg.to],
    subject: msg.subject,
    text:    msg.text,
  };
  if (msg.html)    payload.html     = msg.html;
  if (msg.replyTo) payload.reply_to = msg.replyTo;

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const reason = `network error: ${(e as Error).message}`;
    console.error('[email/resend] fetch failed:', reason);
    return { delivered: false, messageId: null, reason };
  }

  if (res.ok) {
    const body = (await res.json()) as ResendSuccessBody;
    console.info('[email/resend] delivered', { to: msg.to, messageId: body.id });
    return { delivered: true, messageId: body.id };
  }

  // Non-2xx — log the error code but never the API key.
  let detail = `HTTP ${res.status}`;
  try {
    const errBody = (await res.json()) as ResendErrorBody;
    detail = `HTTP ${res.status} ${errBody.name ?? ''}: ${errBody.message ?? ''}`.trim();
  } catch { /* response wasn't JSON */ }

  console.error('[email/resend] send failed:', detail, { to: msg.to, subject: msg.subject });
  return { delivered: false, messageId: null, reason: detail };
}
