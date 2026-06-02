// POST /.netlify/functions/shell-login-magic-link
//
// Body: { email: string, access_token: string }
//
// Exchanges a Supabase magic-link (email OTP) session for an eq_shell_session cookie.
// Mirrors shell-login-phone-otp exactly, keyed by email instead of phone.
//
// Flow:
//   1. Validate the Supabase access_token via auth.getUser() — Supabase verifies
//      the JWT signature + expiry server-side.
//   2. Confirm the email in the Supabase auth user matches the submitted email —
//      prevents a stolen access_token targeting a different account.
//   3. Look up the user in shell_control.users by email.
//   4. Hydrate tenant + entitlements and mint the shell session cookie + Supabase JWT,
//      returning the same payload shape as shell-login so the React session context
//      works identically.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import { signSessionToken, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
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
    .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at')
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

  return jsonResponse(
    200,
    {
      valid: true,
      user,
      tenant,
      entitlements: entitlements ?? [],
      supabase_jwt: supabaseJwt,
    },
    { 'Set-Cookie': cookie },
  );
});
