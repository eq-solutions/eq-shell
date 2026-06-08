// POST /.netlify/functions/shell-login
//
// Body: { email: string, pin: string }
//
// Validates email + bcrypt-compared pin against public.users on the
// eq-shell-control Supabase. On success:
//   - Sets eq_shell_session cookie (HttpOnly, Secure, SameSite=Lax,
//     Domain=.eq.solutions, 7d Max-Age) signed with EQ_SECRET_SALT.
//   - Returns { valid: true, user, tenant, entitlements } where the
//     shape mirrors what verify-shell-session returns on subsequent
//     calls — so the React shell can hydrate either way.
//
// On failure, returns { valid: false } with NO cookie. The error
// message intentionally doesn't distinguish "user not found" from
// "pin wrong" — prevents enumeration.
//
// HONEST CAVEAT: rate limiting isn't wired here yet. Phase 1.B
// inherits the same rate-limit gap EQ Field's verify-pin had before
// SEC2 (PR #99) — to be fixed by extending the same
// rate_limit_buckets pattern to this surface in a follow-up.
//
// Login attempts are logged to stdout (Netlify Function logs) for now.
// A proper `audit_log` table on eq-shell-control is a separate
// follow-up — same shape as eq-field-app's existing audit_log so we
// can eventually unify the two streams.

import bcrypt from 'bcryptjs';
import type { Context } from '@netlify/functions';
import { getServiceClient, getUserMemberships, getEnrichedMemberships, getUserSecurityGroupPerms } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement, UserTenantMembership } from './_shared/supabase.js';
import { signSessionToken, signTenantSelectionToken, buildTotpChallengeIfEnrolled, hasTrustedDeviceFor, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
import type { TenantConfig } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { totpEnrollmentDue } from './_shared/totp.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

// Best-effort structured log of every login attempt. Visible in the
// Netlify Functions dashboard logs; grepable. A real audit_log table
// is a follow-up — see header comment.
// ip should come from context.ip (Netlify-injected, not spoofable).
// x-forwarded-for is NOT used here — it can be forged by the caller.
function logShellLogin(ip: string, email: string, outcome: 'success' | 'failed' | 'malformed', detail?: string): void {
  // eslint-disable-next-line no-console
  console.info('[shell-login]', JSON.stringify({
    at: new Date().toISOString(),
    email,
    outcome,
    ip,
    ...(detail ? { detail } : {}),
  }));
}

export default withSentry(async (req: Request, context: Context): Promise<Response> => {
  // Extract the real client IP from the Netlify context. context.ip is
  // injected by Netlify's edge infrastructure and cannot be spoofed by the
  // caller — unlike x-forwarded-for, which any client can forge.
  const ip = context.ip ?? 'unknown';

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
  }

  let body: { email?: string; pin?: string };
  try {
    body = (await req.json()) as { email?: string; pin?: string };
  } catch {
    logShellLogin(ip, '<unparseable-body>', 'malformed');
    return jsonResponse(400, { valid: false });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const pin = (body.pin ?? '').trim();
  if (!email || !pin) {
    logShellLogin(ip, email || '<empty>', 'malformed', 'missing email or pin');
    return jsonResponse(400, { valid: false });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // Rate limiting: 5 attempts per IP per 15-minute window.
  // Keyed by IP so a single attacker can't enumerate all emails.
  // On success, the key is cleared so legitimate users start fresh.
  const rlKey = `login::${ip}`;

  const { data: rlResult, error: rlErr } = await sb.schema('public').rpc('check_and_increment_rate_limit', {
    p_key: rlKey,
  });
  if (rlErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-login] rate-limit check failed — blocking as precaution:', rlErr.message);
    return jsonResponse(503, { valid: false, error: 'service-unavailable' });
  } else {
    const rl = rlResult as { blocked: boolean; retry_after_seconds: number } | null;
    if (rl?.blocked) {
      logShellLogin(ip, email, 'failed', `rate-limited (retry in ${rl.retry_after_seconds}s)`);
      return jsonResponse(429, { valid: false, error: 'too-many-attempts', retry_after: rl.retry_after_seconds });
    }
  }

  // Look up user by email (canonical layer is global — email is unique
  // across tenants in Phase 1.B; multi-tenant email collision is a
  // Phase 2+ concern).
  // Phase 1.F: select role + is_platform_admin too so the session +
  // Supabase JWT both carry them.
  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active, pin_hash, last_login_at, last_active_tenant_id, totp_secret, totp_enrolled_at, created_at')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle<CanonicalUser>();

  if (userErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-login] supabase users lookup error:', userErr.message);
    logShellLogin(ip, email, 'failed', 'db-error');
    return jsonResponse(500, { error: 'Database error' });
  }
  if (!user || !user.pin_hash) {
    logShellLogin(ip, email, 'failed', 'no-user-or-no-pin');
    void sb.schema('public').rpc('eq_write_audit_log', { p_event: 'login.failed', p_ip: ip, p_detail: { reason: 'no-user-or-no-pin' } });
    return jsonResponse(200, { valid: false });
  }

  const pinOk = await bcrypt.compare(pin, user.pin_hash);
  if (!pinOk) {
    logShellLogin(ip, email, 'failed', 'bad-pin');
    void sb.schema('public').rpc('eq_write_audit_log', { p_event: 'login.failed', p_ip: ip, p_detail: { reason: 'bad-pin' } });
    return jsonResponse(200, { valid: false });
  }

  let memberships: UserTenantMembership[];
  try {
    memberships = await getUserMemberships(user.id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[shell-login] memberships lookup error:', (e as Error).message);
    logShellLogin(ip, email, 'failed', 'memberships-err');
    return jsonResponse(500, { error: 'Database error' });
  }

  if (memberships.length === 0) {
    logShellLogin(ip, email, 'failed', 'no-memberships');
    return jsonResponse(403, { valid: false, error: 'no-memberships' });
  }

  void sb.schema('public').rpc('clear_rate_limit', { p_key: rlKey });

  // Phase 1.G: if the user has TOTP enrolled, gate the session cookie
  // behind a short-lived challenge token. The client navigates to
  // /totp-challenge and posts back with the 6-digit code — UNLESS this
  // device was remembered for 30 days (hasTrustedDeviceFor), in which case
  // the PIN they just passed is sufficient and we fall through to mint the
  // session directly.
  const totpChallenge = buildTotpChallengeIfEnrolled(user);
  if (totpChallenge && !hasTrustedDeviceFor(req, user.id)) {
    logShellLogin(ip, email, 'success', 'totp-challenge-issued');
    return jsonResponse(200, totpChallenge);
  }
  if (totpChallenge) {
    logShellLogin(ip, email, 'success', 'totp-skipped-trusted-device');
  }

  if (memberships.length > 1) {
    const preferred = user.last_active_tenant_id && memberships.find((m) => m.tenant_id === user.last_active_tenant_id)
      ? user.last_active_tenant_id
      : null;

    const tenantIds = memberships.map((m) => m.tenant_id);
    const { data: tenantRows } = await sb
      .from('tenants')
      .select('id, slug, name, brand_color, brand_logo_url, tier, active')
      .in('id', tenantIds)
      .returns<CanonicalTenant[]>();
    const tenantMap = new Map((tenantRows ?? []).map((t) => [t.id, t]));

    const enrichedMemberships = memberships
      .map((m) => {
        const t = tenantMap.get(m.tenant_id);
        if (!t || !t.active) return null;
        return {
          tenant_id: m.tenant_id,
          role: m.role,
          tenant_slug: t.slug,
          tenant_name: t.name,
        };
      })
      .filter((m): m is { tenant_id: string; role: typeof memberships[0]['role']; tenant_slug: string; tenant_name: string } => m !== null);

    if (enrichedMemberships.length === 0) {
      logShellLogin(ip, email, 'failed', 'no-active-tenants');
      return jsonResponse(200, { valid: false });
    }

    if (enrichedMemberships.length === 1) {
      memberships = [{ user_id: user.id, tenant_id: enrichedMemberships[0].tenant_id, role: enrichedMemberships[0].role, active: true }];
    } else {
      const selectionExp = Date.now() + 5 * 60 * 1000;
      const selectionToken = signTenantSelectionToken({
        kind: 'tenant-selection',
        user_id: user.id,
        exp: selectionExp,
      });
      logShellLogin(ip, email, 'success', 'multi-tenant-pending-selection');
      return jsonResponse(200, {
        valid: true,
        requires_tenant_selection: true,
        user_id: user.id,
        selection_token: selectionToken,
        memberships: enrichedMemberships,
        preferred_tenant_id: preferred,
      });
    }
  }

  const activeMembership = memberships[0];
  const activeTenantId = activeMembership.tenant_id;
  const activeRole = activeMembership.role;

  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, tier, active')
    .eq('id', activeTenantId)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    logShellLogin(ip, email, 'failed', tenantErr ? 'tenant-err' : 'tenant-missing-or-inactive');
    return jsonResponse(200, { valid: false });
  }

  const [
    { data: allEntitlements },
    { data: tenantConfigRow },
    { data: routingRow },
  ] = await Promise.all([
    sb.from('module_entitlements').select('module, enabled').eq('tenant_id', tenant.id).returns<CanonicalEntitlement[]>(),
    sb.from('tenant_config').select('feature_flags, field_settings').eq('tenant_id', tenant.id).maybeSingle<{ feature_flags: Record<string, Record<string, unknown>>; field_settings: { timezone: string; currency: string; week_start: 'monday' | 'sunday' } }>(),
    sb.from('tenant_routing').select('status').eq('tenant_id', tenant.id).maybeSingle<{ status: string }>(),
  ]);

  const config: TenantConfig = tenantConfigRow ?? DEFAULT_TENANT_CONFIG;
  const routingStatus = (routingRow?.status ?? null) as 'active' | null;
  const DATA_PLANE_MODULES = new Set(['field', 'service', 'intake']);
  const entitlements = (allEntitlements ?? []).filter((m) => {
    if (!m.enabled) return false;
    if (DATA_PLANE_MODULES.has(m.module)) return routingStatus === 'active';
    return true;
  });

  // Best-effort last_login_at bump. Non-blocking: if the update fails
  // (Supabase blip, RLS regression, etc.) the user still gets their
  // session — we just log the issue and move on.
  const { error: lastLoginErr } = await sb
    .from('users')
    .update({ last_login_at: new Date().toISOString(), last_active_tenant_id: activeTenantId })
    .eq('id', user.id);
  if (lastLoginErr) {
    // eslint-disable-next-line no-console
    console.warn('[shell-login] last_login_at update failed:', lastLoginErr.message);
  }

  logShellLogin(ip, email, 'success');
  void sb.schema('public').rpc('eq_write_audit_log', { p_event: 'login.success', p_actor_id: user.id, p_tenant_id: tenant.id, p_ip: ip, p_detail: { role: activeRole, method: 'pin' } });

  // Best-effort security group perm fetch. Non-blocking: if the table
  // doesn't exist yet (pre-migration deploy) the helper logs and returns [].
  const extra_perms = await getUserSecurityGroupPerms(user.id, tenant.id);

  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: user.id,
    tenant_id: tenant.id,
    active_tenant_id: tenant.id,
    role: activeRole,
    is_platform_admin: user.is_platform_admin,
    memberships: memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role })),
    email: user.email,
    name: user.name ?? null,
    ...(extra_perms.length > 0 ? { extra_perms } : {}),
    config,
    exp,
  });
  // Domain scoping handled by buildSessionCookie — set to .eq.solutions
  // on prod hosts, omitted on previews / localhost so the cookie scopes
  // to the current host instead of being dropped by the browser.
  const cookie = buildSessionCookie(req, cookieValue, {
    maxAgeSeconds: SESSION_TTL_MS / 1000,
  });

  // Strip pin_hash from the returned user payload — clients never see it.
  const { pin_hash, ...userSafe } = user;
  void pin_hash;

  // Supabase JWT lets the browser talk to Supabase directly with tenant
  // scope enforced by RLS. Returned in the response body (not a cookie)
  // so the React shell can attach it as Authorization to Supabase calls.
  // Phase 1.F: now carries eq_role + is_platform_admin too via app_metadata.
  const { token: supabaseJwt } = signSupabaseJwt(
    user.id,
    tenant.id,
    activeRole,
    user.is_platform_admin,
  );

  const userSafeWithActiveRole = { ...userSafe, role: activeRole, tenant_id: tenant.id };

  // Forced-enrolment signal: managers/supervisors/platform-admins past
  // their grace runway must set up a second sign-in step. The shell
  // routes them to /settings/2fa. (User has no TOTP here — enrolled
  // users returned early above via the challenge branch.)
  const requires_totp_enrollment = totpEnrollmentDue({
    role: activeRole,
    isPlatformAdmin: user.is_platform_admin,
    totpEnrolledAt: user.totp_enrolled_at,
    createdAt: user.created_at,
  });

  return jsonResponse(
    200,
    {
      valid: true,
      user: userSafeWithActiveRole,
      tenant,
      entitlements,
      config,
      memberships: await getEnrichedMemberships(user.id).catch(() => memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role }))),
      supabase_jwt: supabaseJwt,
      requires_totp_enrollment,
    },
    { 'Set-Cookie': cookie }
  );
});
