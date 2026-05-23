// GET /.netlify/functions/verify-shell-session
//
// Reads the eq_shell_session cookie, verifies the HMAC, hydrates
// canonical user + tenant + entitlements, returns them. Used by
// the React shell on every route mount to confirm session validity
// and refresh tenant config (entitlements may have changed since
// login — cheap to re-read).
//
// 401 if no cookie / bad sig / expired / user inactive / tenant
// inactive. Cache-Control: no-store so a stale CDN cache never
// returns yes-then-401 thrash.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { withSentry } from './_shared/sentry.js';

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
  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
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

  // Phase 1.F: re-read role + is_platform_admin so role changes (admin
  // demoted a user) take effect on next verify, not just next login.
  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<Omit<CanonicalUser, 'pin_hash'>>();

  if (userErr || !user) {
    return jsonResponse(401, { valid: false });
  }
  // Defensive: cookie claims a tenant_id but the canonical user
  // row now points somewhere else (admin moved them between tenants).
  // Treat as invalid — force re-login so the new tenant context loads.
  if (user.tenant_id !== session.tenant_id) {
    return jsonResponse(401, { valid: false });
  }

  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, tier, active')
    .eq('id', user.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(401, { valid: false });
  }

  const { data: entitlements } = await sb
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  // Mint a fresh Supabase JWT on every session-verify. JWT TTL is short
  // (15min post-1.F) so periodic refresh on route mounts keeps the
  // browser usable for the full session-cookie lifetime (7d) without
  // long-lived bearer tokens sitting in memory. JWT claims now use
  // app_metadata + carry eq_role + is_platform_admin (Phase 1.F).
  const supabaseJwt = signSupabaseJwt(
    user.id,
    tenant.id,
    user.role,
    user.is_platform_admin,
  );

  return jsonResponse(200, {
    valid: true,
    user,
    tenant,
    entitlements: entitlements ?? [],
    supabase_jwt: supabaseJwt,
  });
});
