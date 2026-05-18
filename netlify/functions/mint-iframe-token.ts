// POST /.netlify/functions/mint-iframe-token
//
// Requires a valid eq_shell_session cookie. Returns a short-lived
// (60s) HMAC token in the EXACT shape EQ Field's verifyShellToken()
// expects (Phase 1.C, PR #106 on eq-field-app/demo):
//
//   { kind: 'shell-token', name: string, role: 'staff'|'supervisor', exp: number }
//
// The token is signed with the SAME EQ_SECRET_SALT both deploys
// share — that's how the cross-domain handshake works without a
// shared cookie. The shell embeds Field as
//
//   <iframe src="https://eq-solves-field.netlify.app/#sh=<token>">
//
// Field reads the hash on boot, calls its own
// /.netlify/functions/verify-pin with action="verify-shell-token",
// gets back a 7d Field session, skips the PIN gate.
//
// Role mapping from canonical:
//   canonical role 'admin'      → Field role 'supervisor'
//   anything else (staff/user)  → Field role 'staff'
// This collapses the canonical role taxonomy down to Field's
// two-tier gate. As Field's role system grows (Phase D work,
// see eq-field-app SPRINT-PLAN.md), the mapping expands here.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, signShellToken, hasSecretSalt } from './_shared/token.js';

const IFRAME_TOKEN_TTL_MS = 60 * 1000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }

  const token = readSessionCookie(req);
  const session = verifySessionToken(token);
  if (!session) {
    return jsonResponse(401, { valid: false });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: user, error } = await sb
    .from('users')
    .select('id, email, tenant_id, role, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'email' | 'tenant_id' | 'role' | 'active'>>();

  if (error || !user) {
    return jsonResponse(401, { valid: false });
  }

  const fieldRole: 'staff' | 'supervisor' = user.role === 'admin' ? 'supervisor' : 'staff';

  const shellToken = signShellToken({
    kind: 'shell-token',
    name: user.email,
    role: fieldRole,
    exp: Date.now() + IFRAME_TOKEN_TTL_MS,
  });

  return jsonResponse(200, { token: shellToken });
};
