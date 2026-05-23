// POST /.netlify/functions/mint-service-iframe-token
//
// Requires a valid eq_shell_session cookie. Returns a short-lived (60s)
// HMAC token that EQ Service's /.netlify/functions/shell-auth validates
// to establish a Supabase session for the embedded iframe.
//
// Handshake flow:
//   1. Shell calls this endpoint (POST, credentials: 'include').
//   2. Shell embeds Service at https://eq-solves-service.netlify.app/#sh=<token>
//   3. Service's index page reads the hash, POSTs to shell-auth.
//   4. shell-auth validates HMAC, signs a Supabase session, returns it.
//   5. Service calls supabase.auth.setSession() — app is live.
//
// Token shape: { kind: 'service-token', email, name, eq_role,
//               is_platform_admin, shell_tenant_id, exp }
// Signed with EQ_SECRET_SALT — the SAME secret must be set on the
// eq-solves-service Netlify deploy.
//
// Role mapping canonical → Service:
//   manager + is_platform_admin   → super_admin
//   manager                       → admin
//   supervisor                    → supervisor
//   employee / apprentice         → technician
//   labour_hire                   → read_only

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import {
  verifySessionToken,
  readSessionCookie,
  hasSecretSalt,
  signServiceToken,
} from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const SERVICE_TOKEN_TTL_MS = 60 * 1000; // 60 seconds — one-shot exchange

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
    .select('id, email, name, tenant_id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<
      Pick<CanonicalUser, 'id' | 'email' | 'name' | 'tenant_id' | 'role' | 'is_platform_admin' | 'active'>
    >();

  if (userErr || !user || user.tenant_id !== session.tenant_id) {
    return jsonResponse(401, { valid: false });
  }

  const token = signServiceToken({
    kind: 'service-token',
    email: user.email,
    name: user.name ?? null,
    eq_role: user.role,
    is_platform_admin: user.is_platform_admin,
    shell_tenant_id: user.tenant_id,
    exp: Date.now() + SERVICE_TOKEN_TTL_MS,
  });

  return jsonResponse(200, { token });
});
