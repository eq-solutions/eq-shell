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
import { verifySessionToken, signSessionToken, readSessionCookie, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
import type { TenantConfig } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { totpEnrollmentDue } from './_shared/totp.js';
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
    .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at, totp_enrolled_at, created_at')
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
    { data: allEntitlements },
    { data: tenantConfigRow },
    { data: routingRow },
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
    sb
      .from('tenant_config')
      .select('feature_flags, field_settings')
      .eq('tenant_id', session.active_tenant_id)
      .maybeSingle<{ feature_flags: Record<string, Record<string, unknown>>; field_settings: { timezone: string; currency: string; week_start: 'monday' | 'sunday' } }>(),
    sb
      .from('tenant_routing')
      .select('status')
      .eq('tenant_id', session.active_tenant_id)
      .maybeSingle<{ status: string }>(),
  ]);

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(401, { valid: false });
  }

  const config: TenantConfig = tenantConfigRow ?? DEFAULT_TENANT_CONFIG;
  const routingStatus = (routingRow?.status ?? null) as 'active' | null;

  // Data-plane modules (field, service, intake) require an active tenant_routing
  // row. Tenants without a provisioned data plane have no routing row, so their
  // data-plane modules are hidden until provisioning completes.
  const DATA_PLANE_MODULES = new Set(['field', 'service', 'intake']);
  const entitlements = (allEntitlements ?? []).filter((m) => {
    if (!m.enabled) return false;
    if (DATA_PLANE_MODULES.has(m.module)) return routingStatus === 'active';
    return true;
  });

  const { token: supabaseJwt } = signSupabaseJwt(
    user.id,
    tenant.id,
    activeMembership.role,
    user.is_platform_admin,
  );

  // Refresh extra_perms on every verify call so group changes take effect
  // without requiring a re-login. Best-effort: missing table → empty array.
  const extra_perms = await getUserSecurityGroupPerms(user.id, session.active_tenant_id);

  // Load tenant role overrides for this user's role. Grants merge into
  // extra_perms (additive); denials pass separately so can() applies them
  // before role-default resolution. Best-effort — new table may not exist yet.
  const { data: roleOverrideRows } = await sb
    .from('tenant_role_overrides')
    .select('perm_key, enabled')
    .eq('tenant_id', session.active_tenant_id)
    .eq('role', activeMembership.role);

  const roleGrants: string[] = [];
  const roleDenials: string[] = [];
  for (const r of (roleOverrideRows ?? []) as Array<{ perm_key: string; enabled: boolean }>) {
    if (r.enabled) roleGrants.push(r.perm_key);
    else roleDenials.push(r.perm_key);
  }

  const merged_extra_perms = [...extra_perms, ...roleGrants];

  const userForResponse = {
    ...user,
    tenant_id: tenant.id,
    role: activeMembership.role,
    ...(merged_extra_perms.length > 0 ? { extra_perms: merged_extra_perms } : {}),
    ...(roleDenials.length > 0 ? { denied_perms: roleDenials } : {}),
  };

  // Re-evaluated on every verify (every route mount + 5-min poll), so a
  // manager who passes their grace runway mid-session gets gated to
  // /settings/2fa without needing to re-login — and the flag clears the
  // moment they enrol.
  const requires_totp_enrollment = totpEnrollmentDue({
    role: activeMembership.role,
    isPlatformAdmin: user.is_platform_admin,
    totpEnrolledAt: user.totp_enrolled_at,
    createdAt: user.created_at,
  });

  const body = {
    valid: true,
    user: userForResponse,
    tenant,
    entitlements,
    config,
    memberships: await getEnrichedMemberships(user.id).catch(() => memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role }))),
    supabase_jwt: supabaseJwt,
    requires_totp_enrollment,
  };

  // Transparently upgrade pre-2026-05-28 cookies that lack email/name.
  // Those fields are needed for cookie-based cross-app SSO (Service, Field).
  // We already fetched user.email and user.name above, so re-issuing is free.
  if (!session.email || !session.config) {
    const upgraded = signSessionToken({
      ...session,
      email: user.email,
      name: user.name ?? null,
      config,
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
