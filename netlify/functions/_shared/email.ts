// Outbound email helper for shell functions.
//
// Phase 1.F MVP: log-only fallback. Real provider wiring (Resend?
// SendGrid? — match whatever eq-field's send-email.js settles on) is
// a separate task — when env vars `EQ_EMAIL_PROVIDER` + provider
// API key are present, the helper switches from log-only to real
// delivery automatically.
//
// Until real wiring lands, invite emails appear in the Netlify
// Functions log only. Royce or a tenant admin pastes the invite URL
// to the user manually. Documented in the AdminInviteUser screen.
//
// Tracking item for follow-up: pick a provider + add the wiring,
// matching eq-field's pattern. See `eq-context/eq/pending.md`.

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

  if (!PROVIDER) {
    return logOnly(msg);
  }

  // Future providers slot in here. When ready, add a branch like:
  //
  //   if (PROVIDER === 'resend') return sendViaResend(msg);
  //   if (PROVIDER === 'sendgrid') return sendViaSendGrid(msg);
  //
  // Each provider lives in its own file under _shared/email/<provider>.ts.

  return logOnly(msg);
}
