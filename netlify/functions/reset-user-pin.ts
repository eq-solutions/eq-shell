// POST /.netlify/functions/reset-user-pin
//
// Manager or platform_admin triggers a PIN reset for a user in their
// tenant. Returns a one-time reset URL the admin shares with the user
// (manually, or via email once EQ_EMAIL_PROVIDER is configured).
//
// Body: { user_id: string }
//
// Response:
//   200 OK { ok: true, reset_url, email_delivered }
//   400    { ok: false, error: 'bad-request' }
//   401    { ok: false, error: 'unauthorized' }
//   403    { ok: false, error: 'forbidden' }
//   404    { ok: false, error: 'user-not-found' }
//   500    { ok: false, error: string }

import { createHash, randomBytes } from 'node:crypto';
import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { sendEmail } from './_shared/email.js';
import { withSentry } from './_shared/sentry.js';

const RESET_TTL_HOURS = 24;
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

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  if (!can(session, 'admin.edit_user')) {
    return jsonResponse(403, { ok: false, error: 'forbidden' });
  }

  let body: { user_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  const userId = (body.user_id ?? '').trim();
  if (!userId) {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  const { data: target } = await sb
    .from('users')
    .select('id, email, tenant_id, active')
    .eq('id', userId)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'email' | 'tenant_id' | 'active'>>();

  if (!target) {
    return jsonResponse(403, { ok: false, error: 'forbidden' });
  }

  if (!session.is_platform_admin) {
    const { data: membership } = await sb
      .schema('shell_control')
      .from('user_tenant_memberships')
      .select('user_id, tenant_id')
      .eq('user_id', target.id)
      .eq('tenant_id', session.tenant_id)
      .eq('active', true)
      .maybeSingle<{ user_id: string; tenant_id: string }>();
    if (!membership) {
      return jsonResponse(403, { ok: false, error: 'forbidden' });
    }
  }

  if (!target.active) {
    return jsonResponse(403, { ok: false, error: 'forbidden' });
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

  const { error: insertErr } = await sb
    .schema('shell_control')
    .from('pin_reset_tokens')
    .insert({
      user_id: target.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: session.user_id,
    });

  if (insertErr) {
    // eslint-disable-next-line no-console
    console.error('[reset-user-pin] insert failed:', insertErr.message);
    return jsonResponse(500, { ok: false, error: 'server-error' });
  }

  const resetUrl = resetUrlFor(req, rawToken);

  const emailResult = await sendEmail({
    to: target.email,
    subject: 'Reset your EQ Solutions PIN',
    text:
`Someone at your organisation has requested a PIN reset for your EQ Solutions account.

Click the link below to set a new PIN:

${resetUrl}

This link expires in ${RESET_TTL_HOURS} hours. If you didn't expect this, ignore it — your current PIN still works.

— EQ Solutions`,
  });

  // eslint-disable-next-line no-console
  console.info('[reset-user-pin]', JSON.stringify({
    at: new Date().toISOString(),
    target_user: target.id,
    initiated_by: session.user_id,
    email_delivered: emailResult.delivered,
  }));

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('client-ip')
           ?? 'unknown';
  void sb.schema('public').rpc('eq_write_audit_log', { p_event: 'pin.reset', p_actor_id: session.user_id, p_tenant_id: session.tenant_id, p_ip: ip, p_detail: { target_user: target.id } });

  return jsonResponse(200, {
    ok: true,
    reset_url: resetUrl,
    email_delivered: emailResult.delivered,
  });
});
