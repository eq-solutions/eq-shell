// POST /.netlify/functions/shell-request-pin-reset
//
// Self-service PIN reset request. No auth required — email is the identifier.
// Looks up the email in shell_control.users, generates a one-time token, and
// emails the user a reset link pointing at /reset-pin?token=...
//
// Always returns { ok: true } to prevent email enumeration. Only network /
// DB failures produce a non-200 response.
//
// Body: { email: string }
//
// Response:
//   200 OK { ok: true }
//   400    { ok: false, error: 'bad-request' }
//   500    { ok: false, error: 'server-error' | 'server-misconfigured' }

import { createHash, randomBytes } from 'node:crypto';
import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { hasSecretSalt } from './_shared/token.js';
import { sendEmail } from './_shared/email.js';
import { withSentry } from './_shared/sentry.js';

const RESET_TTL_HOURS = 1;
const RESET_TTL_MS = RESET_TTL_HOURS * 60 * 60 * 1000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function resetUrlFor(req: Request, token: string): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/reset-pin?token=${encodeURIComponent(token)}`;
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { ok: false, error: 'server-misconfigured' });
  }

  let body: { email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  const { data: user } = await sb
    .from('users')
    .select('id, email, active')
    .eq('email', email)
    .maybeSingle<{ id: string; email: string; active: boolean }>();

  // Return ok:true even when no account found — prevents email enumeration.
  if (!user || !user.active) {
    return jsonResponse(200, { ok: true });
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

  const { error: insertErr } = await sb
    .schema('shell_control')
    .from('pin_reset_tokens')
    .insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: user.id,
    });

  if (insertErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-request-pin-reset] insert failed:', insertErr.message);
    return jsonResponse(500, { ok: false, error: 'server-error' });
  }

  const resetUrl = resetUrlFor(req, rawToken);

  await sendEmail({
    to: user.email,
    subject: 'Reset your EQ Solutions PIN',
    text:
`You requested a PIN reset for your EQ Solutions account.

Click the link below to set a new PIN:

${resetUrl}

This link expires in ${RESET_TTL_HOURS} hour. If you didn't request this, ignore it — your current PIN still works.

— EQ Solutions`,
  });

  // eslint-disable-next-line no-console
  console.info('[shell-request-pin-reset]', JSON.stringify({
    at: new Date().toISOString(),
    user_id: user.id,
  }));

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('client-ip')
           ?? 'unknown';
  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'pin.reset.requested',
    p_actor_id: user.id,
    p_tenant_id: null,
    p_ip: ip,
    p_detail: {},
  });

  return jsonResponse(200, { ok: true });
});
