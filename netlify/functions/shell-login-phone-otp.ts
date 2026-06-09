// POST /.netlify/functions/shell-login-phone-otp
//
// Body: { phone: string, access_token: string }
//
// Exchanges a Supabase phone-OTP session (obtained client-side via
// supabase.auth.verifyOtp) for an eq_shell_session cookie.
//
// Flow:
//   1. Validate the Supabase access_token by calling auth.getUser() —
//      this hits Supabase's /auth/v1/user endpoint, which verifies the
//      JWT signature and expiry server-side.
//   2. Confirm the phone in the Supabase auth user matches the submitted
//      phone — prevents a stolen token from looking up a different number.
//   3. Look up the user in shell_control.users by phone.
//   4. Hydrate tenant + entitlements and mint the shell session cookie,
//      returning the same payload shape as shell-login so the React
//      session context works identically.
//
// The access_token TTL is Supabase's default (1 hour). The exchange is
// expected to happen immediately after verifyOtp, so expiry isn't a
// practical concern. The resulting shell session is 7 days, same as
// the email+PIN path.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import { signSessionToken, buildTotpChallengeIfEnrolled, hasTrustedDeviceFor, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
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

// Accepts the E.164 form the client sends (+61XXXXXXXXX) and also
// handles the un-prefixed forms in case of a browser autofill quirk.
function normalizeAuPhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+61') && digits.length === 11) return raw;
  if (digits.startsWith('61') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+61' + digits.slice(1);
  if (digits.length === 9 && digits.startsWith('4')) return '+61' + digits;
  return null;
}

// Cards Flutter web (cards.eq.solutions) calls this on core.eq.solutions —
// cross-origin. Mirror cards-api.ts's allowlist so the browser doesn't block
// the phone-OTP exchange. Native builds send no Origin header → no-op there.
const ALLOWED_ORIGIN_EXACT = new Set<string>(['https://cards.eq.solutions']);
const ALLOWED_ORIGIN_RE = /^https:\/\/deploy-preview-\d+--eq-cards\.netlify\.app$/;

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  if (!ALLOWED_ORIGIN_EXACT.has(origin) && !ALLOWED_ORIGIN_RE.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

async function core(req: Request, _ctx: Context): Promise<Response> {
  if (process.env.ENABLE_PHONE_OTP !== 'true') {
    return new Response(JSON.stringify({ error: 'Not available' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
  }

  let body: { phone?: string; access_token?: string };
  try {
    body = (await req.json()) as { phone?: string; access_token?: string };
  } catch {
    return jsonResponse(400, { valid: false });
  }

  const phone = normalizeAuPhone((body.phone ?? '').trim());
  const accessToken = (body.access_token ?? '').trim();
  if (!phone || !accessToken) {
    return jsonResponse(400, { valid: false });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // Validate the Supabase access_token. getUser(jwt) calls /auth/v1/user
  // with the provided JWT as the Bearer token — Supabase verifies the
  // signature and expiry and returns the auth user record.
  //
  // Retry once on transient failure: GoTrue occasionally returns 403
  // immediately after phone OTP verification (observed 2026-06-06T21:32Z —
  // the session wasn't fully committed when the Lambda called /user ~1s
  // after verifyOtp). A 500ms pause resolves it without a second OTP.
  let authUser: { phone?: string | null; id?: string } | null = null;
  let authErr: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    const result = await sb.auth.getUser(accessToken);
    authErr = result.error;
    authUser = result.data?.user ?? null;
    if (!authErr && authUser) break;
  }
  if (authErr || !authUser) {
    return jsonResponse(200, { valid: false });
  }

  // The phone in Supabase auth.users must exactly match what was submitted.
  // Supabase stores phones in E.164; our normalizeAuPhone also produces E.164.
  const supabasePhone = normalizeAuPhone(authUser.phone ?? '');
  if (!supabasePhone || supabasePhone !== phone) {
    return jsonResponse(200, { valid: false });
  }

  // Look up the Shell user by phone.
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
    // eslint-disable-next-line no-console
    console.error('[shell-login-phone-otp] users lookup error:', userErr.message);
    return jsonResponse(500, { error: 'Database error' });
  }

  // ── Email-based self-heal fallback ───────────────────────────────────────
  // When phone-OTP succeeds (authUser is valid) but shell_control.users has no
  // phone set yet (e.g. the user signed up via email before their worker record
  // was created), look them up by email and patch the phone link on the fly.
  // After this runs, future phone-OTP logins hit the fast path (phone lookup).
  if (!user) {
    const authEmail = (authUser as { email?: string | null }).email?.toLowerCase();
    if (authEmail) {
      const { data: emailUser, error: emailErr } = await sb
        .from('users')
        .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at, totp_secret, totp_enrolled_at, created_at')
        .eq('email', authEmail)
        .is('phone', null)
        .eq('active', true)
        .maybeSingle<UserRow>();

      if (!emailErr && emailUser) {
        // Patch phone on shell_control.users so the fast path works next time
        void sb.from('users').update({ phone }).eq('id', emailUser.id);
        // Patch auth.users via admin API (service role)
        void (sb as unknown as {
          auth: { admin: { updateUserById: (id: string, attrs: Record<string, unknown>) => Promise<unknown> } };
        }).auth.admin.updateUserById(emailUser.id, { phone });
        // Also claim the worker if it exists and is unclaimed
        void sb.schema('public').from('workers')
          .update({ user_id: emailUser.id })
          .eq('email', authEmail)
          .is('user_id', null);
        // eslint-disable-next-line no-console
        console.info('[shell-login-phone-otp] email-fallback self-heal for', authEmail);
        user = emailUser;
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  if (!user) {
    return jsonResponse(200, { valid: false });
  }

  // Second-factor gate — identical to the PIN and magic-link doors. Enrolled
  // users get a 5-minute challenge and NO session cookie here; the client
  // completes login at /totp-challenge. Skipped when this device was remembered
  // for 30 days (hasTrustedDeviceFor) — the OTP they just passed is enough.
  const totpChallenge = buildTotpChallengeIfEnrolled(user);
  if (totpChallenge && !hasTrustedDeviceFor(req, user.id)) {
    return jsonResponse(200, totpChallenge);
  }

  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, active')
    .eq('id', user.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(200, { valid: false });
  }

  const { data: entitlements } = await sb
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  void sb
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
    p_detail: { method: 'phone-otp', role: user.role },
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

  // Forced-enrolment signal — mirrors shell-login + magic-link so every
  // door agrees. (Enrolled users returned early via the challenge branch.)
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
}

export default withSentry(async (req: Request, ctx: Context): Promise<Response> => {
  // CORS: handle the cross-origin preflight from cards.eq.solutions, and add
  // the allow headers to every response so the browser exposes the body.
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  const res = await core(req, ctx);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
