// POST /.netlify/functions/shell-login-magic-link
//
// Body: { email: string, access_token: string }
//
// Exchanges a Supabase magic-link (email OTP) session for an eq_shell_session cookie.
// Mirrors shell-login-phone-otp exactly, keyed by email instead of phone.
//
// Flow:
//   1. Rate-limit check: 5 attempts per email per 15-minute window, keyed by
//      "magic-link:<email>". Returns 429 with Retry-After if exceeded.
//   2. Validate the Supabase access_token via auth.getUser() — Supabase verifies
//      the JWT signature + expiry server-side.
//   3. Confirm the email in the Supabase auth user matches the submitted email —
//      prevents a stolen access_token targeting a different account.
//   4. Look up the user in shell_control.uses by email.
//   5. Hydrate tenant + entitlements and mint the shell session cookie + Supabase JWT,
//      returning the same payload shape as shell-login so the React session context
//      works identically.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import { signSessionToken, buildTotpChallengeIfEnrolled, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { totpEnrollmentDue } from './_shared/totp.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
  }

  let body: { email?: string; access_token?: string };
  try {
    body = (await req.json()) as { email?: string; access_token?: string };
  } catch {
    return jsonResponse(400, { valid: false });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const accessToken = (body.access_token ?? '').trim();
  if (!email || !accessToken) {
    return jsonResponse(400, { valid: false });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // Rate limiting: 5 attempts per email per 15-minute window.
  // Keyed by email so a single attacker can't flood one account.
  // On success, the key is cleared so legitimate users start fresh.
  const rlKey = `magic-link::${email}`;

  const { data: rlResult, error: rlErr } = await sb.schema('public').rpc('check_and_increment_rate_limit', {
    p_key: rlKey,
  });
  if (rlErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-login-magic-link] rate-limit check failed — blocking as precaution:', rlErr.message);
    return jsonResponse(503, { valid: false, error: 'service-unavailable' });
  } else {
    const rl = rlResult as { blocked: boolean; retry_after_seconds: number } | null;
    if (rl?.blocked) {
      return jsonResponse(429, { valid: false, error: 'too-many-attempts', retry_after: rl.retry_after_seconds }, {
        'Retry-After': String(rl.retry_after_seconds),
      });
    }
  }

  // Validate the access_token. getUser(jwt) hits /auth/v1/user with the token as
  // Bearer — Supabase verifies signature + expiry and returns the auth user record.
  const { data: { user: authUser }, error: authErr } = await sb.auth.getUser(accessToken);
  if (authErr || !authUser) {
    return jsonResponse(200, { valid: false });
  }

  // The email in the Supabase auth user must match what the client submitted.
  if ((authUser.email ?? '').toLowerCase() !== email) {
    return jsonResponse(200, { valid: false });
  }

  type UserRow = Omit<CanonicalUser, 'pin_hash' | 'phone'>;
  const { data: user, error: userErr } = await sb
    .schema('shell_control')
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at, totp_secret, totp_enrolled_at, created_at')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle<UserRow>();

  if (userErr) {
    console.error('[shell-login-magic-link] users lookup error:', userErr.message);
    return jsonResponse(500, { error: 'Database error' });
  }
  if (!user) {
    // Email exists in Supabase Auth but has no shell_control.users row — not yet provisioned.
    return jsonResponse(200, { valid: false, error: 'no-account' });
  }

  // Second-factor gate — identical to the PIN door. If TOTP is enrolled we
  // issue a 5-minute challenge here and mint NO session cookie; the client
  // completes login at /totp-challenge. Keeps forced-MFA un-bypassable by
  // switching sign-in method.
  const totpChallenge = buildTotpChallengeIfEnrolled(user);
  if (totpChallenge) {
    return jsonResponse(200, totpChallenge);
  }

  const { data: tenant, error: tenantErr } = await sb
    .schema('shell_control')
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, active')
    .eq('id', user.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(200, { valid: false });
  }

  const { data: entitlements } = await sb
    .schema('public')
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  void sb
    .schema('shell_control')
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('client-ip') ??
    'unknown';

  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'login.success',
    p_actor_id: user.id,
    p_tenant_id: tenant.id,
    p_ip: ip,
    p_detail: { method: 'magic-link', role: user.role },
  });

  // Clear the rate-limit bucket on successful login so legitimate users
  // start fresh the next time they need to authenticate.
  void sb.schema('public').rpc('clear_rate_limit', { p_key: rlKey });

  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: user.id,
    tenant_id: tenant.id,
    active_tenant_id: tenant.id,
    role: user.role,
    is_platform_admin: user.is_platform_admin,
    memberships: [{ tenant_id: tenant.id, role: user.role }],
    config: DEFAULT_TENANT_CONFIG,
    exp,
  });
  const cookie = buildSessionCookie(req, cookieValue, {
    maxAgeSeconds: SESSION_TTL_MS / 1000,
  });

  const { token: supabaseJwt } = signSupabaseJwt(
    user.id,
    tenant.id,
    user.role,
    user.is_platform_admin,
  );

  // Forced-enrolment signal — managers/supervisors/platform-admins past
  // their grace runway must set up a second sign-in step. The shell routes
  // them to /settings/2fa. (Enrolled users returned early via the challenge
  // branch above.) Mirrors shell-login so every door agrees.
  const requires_totp_enrollment = totpEnrollmentDue({
    role: user.role,
    isPlatformAdmin: user.is_platform_admin,
    totpEnrolledAt: user.totp_enrolled_at,
    createdAt: user.created_at,
  });

  return jsonResponse(
    200,
    {
      valid: true,
      user,
      tenant,
      entitlements: entitlements ?? [],
      supabase_jwt: supabaseJwt,
      requires_totp_enrollment,
    },
    { 'Set-Cookie': cookie },
  );
});
