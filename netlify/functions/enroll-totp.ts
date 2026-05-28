// POST /.netlify/functions/enroll-totp
//
// Phase 1.G — TOTP enrollment initiation.
//
// Requires: valid eq_shell_session cookie.
//
// Generates a new TOTP secret and stores it on the user row
// (unconfirmed — totp_enrolled_at remains null until confirm-totp
// succeeds). Returns the otpauth:// URI and the raw secret for
// display. The client shows a QR code + manual-entry code.
//
// Re-calling before confirm-totp replaces the pending secret.
// Calling after enrollment replaces the enrolled secret (re-enroll
// flow — the old secret is invalidated immediately).
//
// Response:
//   200 { ok: true, otpauth_uri, secret }
//   401 { ok: false, error: 'unauthorized' }
//   500 { ok: false, error: string }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { generateTotpSecret, buildOtpauthUri } from './_shared/totp.js';
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

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  // Look up the user's email for the otpauth URI label.
  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, email')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<{ id: string; email: string }>();

  if (userErr || !user) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  const secret = generateTotpSecret();
  const otpauthUri = buildOtpauthUri(secret, user.email);

  // Store the secret. totp_enrolled_at is NOT set — enrollment is
  // only confirmed once confirm-totp verifies the first code.
  const { error: updateErr } = await sb
    .from('users')
    .update({ totp_secret: secret, totp_enrolled_at: null })
    .eq('id', user.id);

  if (updateErr) {
    // eslint-disable-next-line no-console
    console.error('[enroll-totp] secret store failed:', updateErr.message);
    return jsonResponse(500, { ok: false, error: 'server-error' });
  }

  return jsonResponse(200, { ok: true, otpauth_uri: otpauthUri, secret });
});
