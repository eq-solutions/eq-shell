// POST /.netlify/functions/mint-quotes-iframe-token
//
// Requires a valid eq_shell_session cookie. Returns a short-lived (60s)
// HMAC token that EQ Quotes' receiver route will validate to establish a
// session for the embedded iframe (Phase 3+).
//
// Handshake flow (Phase 3 target):
//   1. Shell calls this endpoint (POST, credentials: 'include').
//   2. Shell embeds Quotes at https://eq-solves-quotes.netlify.app/#sh=<token>
//   3. Quotes' receiver reads the hash, POSTs to its own shell-auth function.
//   4. shell-auth validates HMAC, signs a Supabase session, returns it.
//   5. Quotes calls supabase.auth.setSession() — app is live.
//
// Token shape: { kind: 'quotes-token', user_id, tenant_id, role, eq_role,
//               is_platform_admin, name, exp }
// Signed with EQ_SECRET_SALT — the SAME secret must be set on the
// EQ Quotes Netlify deploy when the receiver is implemented.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import {
  verifySessionToken,
  readSessionCookie,
  hasSecretSalt,
  signQuotesToken,
} from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const QUOTES_TOKEN_TTL_MS = 60 * 1000; // 60 seconds — one-shot exchange

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }

  const cookieToken = readSessionCookie(req);
  const session = verifySessionToken(cookieToken);
  if (!session) {
    return jsonResponse(401, { valid: false });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, name, tenant_id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<
      Pick<CanonicalUser, 'id' | 'name' | 'tenant_id' | 'role' | 'is_platform_admin' | 'active'>
    >();

  if (userErr || !user || user.tenant_id !== session.tenant_id) {
    return jsonResponse(401, { valid: false });
  }

  const token = signQuotesToken({
    kind: 'quotes-token',
    user_id: user.id,
    tenant_id: user.tenant_id,
    role: user.role,
    eq_role: user.role,
    is_platform_admin: user.is_platform_admin,
    name: user.name ?? null,
    exp: Date.now() + QUOTES_TOKEN_TTL_MS,
  });

  return jsonResponse(200, { token });
});
