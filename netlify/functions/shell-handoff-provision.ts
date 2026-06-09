// POST /.netlify/functions/shell-handoff-provision
//
// Body: { access_token: string }
//
// Called by EQ Cards immediately after a successful self-serve tenant
// provisioning flow. The admin's GoTrue access_token is passed in the
// #sh= URL hash; Shell JS strips the hash and POSTs here to exchange it
// for a shell session cookie — so the admin lands in their new workspace
// already logged in, without a second OTP.
//
// Unlike shell-login-phone-otp, this function:
//  - Does NOT require a phone in the body (phone is read from GoTrue user).
//  - Does NOT check ENABLE_PHONE_OTP — the provision handoff is its own door.
//  - Does NOT rate-limit — the GoTrue JWT is the gate; it requires a real OTP
//    to obtain and is only valid for 1 hour.
//  - Is same-origin only — no CORS headers. Shell JS calls this directly.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import {
  signSessionToken,
  buildTotpChallengeIfEnrolled,
  hasTrustedDeviceFor,
  hasSecretSalt,
  DEFAULT_TENANT_CONFIG,
} from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { totpEnrollmentDue } from './_shared/totp.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function normalizeAuPhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+61') && digits.length === 11) return raw;
  if (digits.startsWith('61') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+61' + digits.slice(1);
  if (digits.length === 9 && digits.startsWith('4')) return '+61' + digits;
  return null;
}

async function core(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  if (!hasSecretSalt()) return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  if (!hasSupabaseJwtSecret()) return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });

  let body: { access_token?: string };
  try {
    body = (await req.json()) as { access_token?: string };
  } catch {
    return jsonResponse(400, { valid: false });
  }

  const accessToken = (body.access_token ?? '').trim();
  if (!accessToken) return jsonResponse(400, { valid: false, error: 'access_token required' });

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // ── Validate GoTrue token (2-attempt retry, same as shell-login-phone-otp) ──
  let authUser: { phone?: string | null; id?: string; email?: string | null } | null = null;
  let authErr: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 500));
    const result = await sb.auth.getUser(accessToken);
    authErr = result.error;
    authUser = result.data?.user ?? null;
    if (!authErr && authUser) break;
  }
  if (authErr || !authUser) {
    return jsonResponse(401, { valid: false, error: 'Token validation failed' });
  }

  // ── Resolve phone from GoTrue user ────────────────────────────────────────
  const phone = normalizeAuPhone(authUser.phone ?? '');
  if (!phone) {
    return jsonResponse(401, { valid: false, error: 'No phone on GoTrue user' });
  }

  // ── Look up shell_control.users by phone ──────────────────────────────────
  type UserRow = Omit<CanonicalUser, 'pin_hash' | 'phone'>;
  let user: UserRow | null;
  let userErr: { message: string } | null;
  ({ data: user, error: userErr } = await sb
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at, totp_secret, totp_enrolled_at, created_at')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle<UserRow>());

  if (userErr) {
    console.error('[shell-handoff-provision] users lookup error:', userErr.message);
    return jsonResponse(500, { error: 'Database error' });
  }
  if (!user) {
    // User was just provisioned — should always be found. If not, something
    // went wrong in the provision step. Return valid:false; Shell will show login.
    return jsonResponse(404, { valid: false, error: 'User not found' });
  }

  // ── TOTP gate (same as all other login doors) ─────────────────────────────
  const totpChallenge = buildTotpChallengeIfEnrolled(user);
  if (totpChallenge && !hasTrustedDeviceFor(req, user.id)) {
    return jsonResponse(200, totpChallenge);
  }

  // ── Tenant + entitlements ─────────────────────────────────────────────────
  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, active')
    .eq('id', user.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(404, { valid: false, error: 'Tenant not found or inactive' });
  }

  const { data: entitlements } = await sb
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  void sb.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('client-ip') ??
    'unknown';

  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'login.success',
    p_actor_id: user.id,
    p_tenant_id: tenant.id,
    p_ip: ip,
    p_detail: { method: 'provision-handoff', role: user.role },
  });

  // ── Mint shell session cookie ──────────────────────────────────────────────
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
  const cookie = buildSessionCookie(req, cookieValue, { maxAgeSeconds: SESSION_TTL_MS / 1000 });

  const { token: supabaseJwt } = signSupabaseJwt(
    user.id,
    tenant.id,
    user.role,
    user.is_platform_admin,
  );

  const requires_totp_enrollment = totpEnrollmentDue({
    role: user.role,
    isPlatformAdmin: user.is_platform_admin,
    totpEnrolledAt: user.totp_enrolled_at,
    createdAt: user.created_at,
  });

  return new Response(
    JSON.stringify({
      valid: true,
      user,
      tenant,
      entitlements: entitlements ?? [],
      supabase_jwt: supabaseJwt,
      requires_totp_enrollment,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': cookie,
      },
    },
  );
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  return core(req);
});
