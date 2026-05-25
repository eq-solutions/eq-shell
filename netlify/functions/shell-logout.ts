// POST /.netlify/functions/shell-logout
//
// Clears the eq_shell_session cookie server-side. The cookie is
// HttpOnly + signed, so the browser can't drop it via JS — that's
// the security guarantee. This endpoint is what the Sign out button
// actually needs to hit.
//
// Pre-2026-05-21 the React shell only cleared local state + navigated
// to '/', leaving the cookie intact. The verify-shell-session
// endpoint would re-hydrate the session on the next page load and
// the user would silently be signed back in. Real bug. This fixes it.
//
// Optional defense-in-depth: also revoke the JWT's jti in
// shell_control.revoked_sessions so any in-flight Supabase JWT minted
// from the now-expired cookie is rejected within the next mint cycle.
// Not implemented in this pass because the cookie clear is the
// load-bearing change.

import type { Context } from '@netlify/functions';
import { buildSessionCookie } from './_shared/cookie.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { getServiceClient } from './_shared/supabase.js';
import { withSentry } from './_shared/sentry.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Best-effort audit write — read session before clearing cookie.
  const session = verifySessionToken(readSessionCookie(req));
  if (session) {
    try {
      const sb = getServiceClient();
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
               ?? req.headers.get('client-ip')
               ?? 'unknown';
      void sb.schema('public').rpc('eq_write_audit_log', { p_event: 'logout', p_actor_id: session.user_id, p_tenant_id: session.tenant_id, p_ip: ip, p_detail: {} });
    } catch {
      // Non-fatal — proceed with cookie clear regardless.
    }
  }

  // Mirror the cookie attributes set in shell-login so the browser
  // accepts the clear directive. Setting Max-Age=0 + Expires in the
  // past asks the browser to drop the cookie immediately. Domain +
  // Path must match the original Set-Cookie or the browser keeps a
  // separately-scoped copy alive — buildSessionCookie derives Domain
  // from the request host, same logic as shell-login.
  const clearCookie = buildSessionCookie(req, '', { clear: true });

  return jsonResponse(200, { ok: true }, { 'Set-Cookie': clearCookie });
});
