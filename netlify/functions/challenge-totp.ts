// POST /.netlify/functions/challenge-totp
//
// Phase 1.G — TOTP login challenge.
//
// Public endpoint — called after shell-login returns requires_totp: true.
//
// Body: { totp_challenge_token: string, code: string }
//
// The totp_challenge_token is a short-lived (5 min) HMAC token minted
// by shell-login after PIN verify succeeds when the user has TOTP enrolled.
// It carries the user_id; this function re-fetches tenant/memberships
// rather than trusting a larger payload on the wire.
//
// On success: issues the eq_shell_session cookie (same as shell-login)
// and returns the full session body.
//
// Response:
//   200 { valid: true, user, tenant, entitlements, memberships, supabase_jwt }
//         with Set-Cookie: eq_shell_session=...
//   200 { valid: false }              — bad code / expired token
//   400 { valid: false, error: ... }  — malformed body
//   500 { valid: false, error: ... }  — server error

import type { Context } from '@netlify/functions';
import {
  getServiceClient,
  getUserMemberships,
  getEnrichedMemberships,
} from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import {
  signSessionToken,
  verifyTotpChallengeToken,
  hasSecretSalt,
} from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { verifyTotp } from './_shared/totp.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — same as shell-login

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

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { valid: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { valid: false, error: 'server-misconfigured' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { valid: false, error: 'server-misconfigured' });
  }

  let body: { totp_challenge_token?: string; code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { valid: false, error: 'bad-request' });
  }

  const challengePayload = verifyTotpChallengeToken(body.totp_challenge_token);
  if (!challengePayload) {
    return jsonResponse(200, { valid: false });
  }

  const code = (body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse(200, { valid: false });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { valid: false, error: (e as Error).message });
  }

  // Rate-limit TOTP code attempts. The challenge token binds to a user_id, so
  // without this the 6-digit second factor is brute-forcible within the token's
  // 5-minute window. Keyed per user (not IP) so the limit can't be evaded by
  // rotating source IPs. Fail closed if the limiter errors — same posture as
  // shell-login.
  const { data: rlResult, error: rlErr } = await sb.schema('public').rpc('check_and_increment_rate_limit', {
    p_key: `totp::${challengePayload.user_id}`,
  });
  if (rlErr) {
    // eslint-disable-next-line no-console
    console.error('[challenge-totp] rate-limit check failed — blocking as precaution:', rlErr.message);
    return jsonResponse(503, { valid: false, error: 'service-unavailable' });
  }
  const rl = rlResult as { blocked: boolean; retry_after_seconds: number } | null;
  if (rl?.blocked) {
    return jsonResponse(429, { valid: false, error: 'too-many-attempts', retry_after: rl.retry_after_seconds });
  }

  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active, pin_hash, last_login_at, last_active_tenant_id, totp_secret, totp_enrolled_at')
    .eq('id', challengePayload.user_id)
    .eq('active', true)
    .maybeSingle<CanonicalUser>();

  if (userErr || !user || !user.totp_secret || !user.totp_enrolled_at) {
    return jsonResponse(200, { valid: false });
  }

  if (!verifyTotp(user.totp_secret, code)) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    void sb.schema('public').rpc('eq_write_audit_log', {
      p_event: 'login.totp.failed',
      p_actor_id: user.id,
      p_ip: ip,
      p_detail: { reason: 'bad-code' },
    });
    return jsonResponse(200, { valid: false });
  }

  // TOTP passed — complete the login the same way shell-login does.
  const memberships = await getUserMemberships(user.id).catch(() => null);
  if (!memberships || memberships.length === 0) {
    return jsonResponse(200, { valid: false });
  }

  // Prefer the last-active tenant; fall back to first membership.
  const activeMembership =
    (user.last_active_tenant_id &&
      memberships.find((m) => m.tenant_id === user.last_active_tenant_id)) ||
    memberships[0];

  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, field_tenant_slug, tier, active')
    .eq('id', activeMembership.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(200, { valid: false });
  }

  const { data: entitlements } = await sb
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  // Bump last_login_at — best-effort.
  void sb
    .from('users')
    .update({ last_login_at: new Date().toISOString(), last_active_tenant_id: tenant.id })
    .eq('id', user.id);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'login.totp.success',
    p_actor_id: user.id,
    p_tenant_id: tenant.id,
    p_ip: ip,
    p_detail: { role: activeMembership.role },
  });

  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: user.id,
    tenant_id: tenant.id,
    active_tenant_id: tenant.id,
    role: activeMembership.role,
    is_platform_admin: user.is_platform_admin,
    memberships: memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role })),
    email: user.email,
    name: user.name ?? null,
    exp,
  });
  const cookie = buildSessionCookie(req, cookieValue, {
    maxAgeSeconds: SESSION_TTL_MS / 1000,
  });

  const supabaseJwt = signSupabaseJwt(
    user.id,
    tenant.id,
    activeMembership.role,
    user.is_platform_admin,
  );

  const { pin_hash, totp_secret, ...userSafe } = user;
  void pin_hash; void totp_secret;

  return jsonResponse(
    200,
    {
      valid: true,
      user: { ...userSafe, role: activeMembership.role, tenant_id: tenant.id },
      tenant,
      entitlements: entitlements ?? [],
      memberships: await getEnrichedMemberships(user.id).catch(() =>
        memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role })),
      ),
      supabase_jwt: supabaseJwt,
    },
    { 'Set-Cookie': cookie },
  );
});
