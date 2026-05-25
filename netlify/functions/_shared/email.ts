// Outbound email helper for shell functions.
//
// Provider is selected by `EQ_EMAIL_PROVIDER` env var (case-insensitive):
//   "resend"  → Resend REST API (see email/resend.ts). Requires RESEND_API_KEY.
//   (unset)   → log-only fallback — invite URL printed to function logs only.
//
// The log-only fallback lets the invite flow work without email during
// local dev and before the provider is configured. `email_delivered: false`
// is returned in the invite-user response body so the caller can surface a
// warning to the admin ("Email not sent — copy the link below").

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Required. */
  text: string;
  /** Optional HTML body. Falls back to wrapping `text` when omitted. */
  html?: string;
  /** Optional reply-to override. Defaults to the configured From address. */
  replyTo?: string;
}

export interface EmailResult {
  delivered: boolean;
  /** Provider's message ID when available, otherwise null. */
  messageId: string | null;
  /** When `delivered === false`, the reason. Never includes API keys. */
  reason?: string;
}

const PROVIDER = (process.env.EQ_EMAIL_PROVIDER ?? '').toLowerCase();

function logOnly(msg: EmailMessage): EmailResult {
  // eslint-disable-next-line no-console
  console.info('[email]', JSON.stringify({
    provider: 'log-only',
    to: msg.to,
    subject: msg.subject,
    text_preview: msg.text.slice(0, 200),
    at: new Date().toISOString(),
  }));
  return { delivered: false, messageId: null, reason: 'log-only fallback — no provider configured' };
}

/**
 * Send a transactional email. Returns `{ delivered: false }` when no
 * provider is configured — the caller decides whether that's a failure
 * (e.g. invite flow should warn the admin) or acceptable (e.g.
 * audit-log notification).
 *
 * Never throws — provider errors are caught and returned as
 * `{ delivered: false, reason }`. The caller should always check
 * `delivered` before assuming the user got the message.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  if (!msg.to || !msg.subject || !msg.text) {
    return { delivered: false, messageId: null, reason: 'missing required fields (to/subject/text)' };
  }

  if (PROVIDER === 'resend') {
    const { sendViaResend } = await import('./email/resend.js');
    return sendViaResend(msg);
  }

  // No provider configured — log and return delivered:false so the
  // caller can surface a manual-copy prompt to the admin.
  return logOnly(msg);
}
