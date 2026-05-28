// POST /.netlify/functions/confirm-totp
//
// Phase 1.G — TOTP enrollment confirmation.
//
// Requires: valid eq_shell_session cookie + { code: string } body.
//
// The user has scanned the QR (or typed the secret) and submitted
// their first 6-digit code. We verify it against the pending
// totp_secret on their row. On success, totp_enrolled_at is set
// and TOTP challenges will gate future logins.
//
// Response:
//   200 { ok: true }
//   400 { ok: false, error: 'bad-code' | 'bad-request' }
//   401 { ok: false, error: 'unauthorized' }
//   409 { ok: false, error: 'no-pending-secret' }  — enroll-totp not called first
//   500 { ok: false, error: string }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { verifyTotp } from './_shared/totp.js';
import { withSentry } from './_shared/sentry.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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

  let body: { code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  const code = (body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse(400, { ok: false, error: 'bad-code' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, totp_secret, totp_enrolled_at')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'totp_secret' | 'totp_enrolled_at'>>();

  if (userErr || !user) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  if (!user.totp_secret) {
    return jsonResponse(409, { ok: false, error: 'no-pending-secret' });
  }

  if (!verifyTotp(user.totp_secret, code)) {
    return jsonResponse(400, { ok: false, error: 'bad-code' });
  }

  const { error: updateErr } = await sb
    .from('users')
    .update({ totp_enrolled_at: new Date().toISOString() })
    .eq('id', user.id);

  if (updateErr) {
    // eslint-disable-next-line no-console
    console.error('[confirm-totp] enrolled_at update failed:', updateErr.message);
    return jsonResponse(500, { ok: false, error: 'server-error' });
  }

  return jsonResponse(200, { ok: true });
});
