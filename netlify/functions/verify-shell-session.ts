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
import { getServiceClient, getUserMemberships, getEnrichedMemberships, getUserSecurityGroupPerms } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import { verifySessionToken, signSessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
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

  let memberships;
  try {
    memberships = await getUserMemberships(user.id);
  } catch {
    return jsonResponse(401, { valid: false });
  }

  const activeMembership = memberships.find((m) => m.tenant_id === session.active_tenant_id);
  if (!activeMembership) {
    return jsonResponse(401, { valid: false });
  }

  const [
    { data: tenant, error: tenantErr },
    { data: entitlements },
  ] = await Promise.all([
    sb
      .from('tenants')
      .select('id, slug, name, brand_color, brand_logo_url, field_tenant_slug, tier, active')
      .eq('id', session.active_tenant_id)
      .maybeSingle<CanonicalTenant>(),
    sb
      .from('module_entitlements')
      .select('module, enabled')
      .eq('tenant_id', session.active_tenant_id)
      .returns<CanonicalEntitlement[]>(),
  ]);

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(401, { valid: false });
  }

  const supabaseJwt = signSupabaseJwt(
    user.id,
    tenant.id,
    activeMembership.role,
    user.is_platform_admin,
  );

  // Refresh extra_perms on every verify call so group changes take effect
  // without requiring a re-login. Best-effort: missing table → empty array.
  const extra_perms = await getUserSecurityGroupPerms(user.id, session.active_tenant_id);

  const userForResponse = {
    ...user,
    tenant_id: tenant.id,
    role: activeMembership.role,
    ...(extra_perms.length > 0 ? { extra_perms } : {}),
  };

  const body = {
    valid: true,
    user: userForResponse,
    tenant,
    entitlements: entitlements ?? [],
    memberships: await getEnrichedMemberships(user.id).catch(() => memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role }))),
    supabase_jwt: supabaseJwt,
  };

  // Transparently upgrade pre-2026-05-28 cookies that lack email/name.
  // Those fields are needed for cookie-based cross-app SSO (Service, Field).
  // We already fetched user.email and user.name above, so re-issuing is free.
  if (!session.email) {
    const upgraded = signSessionToken({
      ...session,
      email: user.email,
      name: user.name ?? null,
    });
    const upgradedCookie = buildSessionCookie(req, upgraded, {
      maxAgeSeconds: Math.max(0, Math.floor((session.exp - Date.now()) / 1000)),
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': upgradedCookie,
      },
    });
  }

  return jsonResponse(200, body);
});
