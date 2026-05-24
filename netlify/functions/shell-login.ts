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
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import { signSessionToken, hasSecretSalt } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
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
function logShellLogin(req: Request, email: string, outcome: 'success' | 'failed' | 'malformed', detail?: string): void {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('client-ip') ?? 'unknown';
  // eslint-disable-next-line no-console
  console.info('[shell-login]', JSON.stringify({
    at: new Date().toISOString(),
    email,
    outcome,
    ip,
    ...(detail ? { detail } : {}),
  }));
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
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
    logShellLogin(req, '<unparseable-body>', 'malformed');
    return jsonResponse(400, { valid: false });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const pin = (body.pin ?? '').trim();
  if (!email || !pin) {
    logShellLogin(req, email || '<empty>', 'malformed', 'missing email or pin');
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
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('client-ip')
           ?? 'unknown';
  const rlKey = `login::${ip}`;

  const { data: rlResult, error: rlErr } = await sb.rpc('check_and_increment_rate_limit', {
    p_key: rlKey,
  });
  if (rlErr) {
    // Non-fatal: if rate limit check fails, log and allow the attempt.
    // eslint-disable-next-line no-console
    console.warn('[shell-login] rate-limit check failed (allowing):', rlErr.message);
  } else {
    const rl = rlResult as { blocked: boolean; retry_after_seconds: number } | null;
    if (rl?.blocked) {
      logShellLogin(req, email, 'failed', `rate-limited (retry in ${rl.retry_after_seconds}s)`);
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
    .select('id, email, tenant_id, role, is_platform_admin, active, pin_hash, last_login_at')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle<CanonicalUser>();

  if (userErr) {
    // PGRST116 = multiple rows returned — two tenants share this email.
    // Return invalid-credentials (don't leak the collision to the caller).
    if ((userErr as unknown as { code?: string }).code === 'PGRST116') {
      // eslint-disable-next-line no-console
      console.error('[shell-login] duplicate email across tenants — needs unique constraint migration:', email);
      logShellLogin(req, email, 'failed', 'duplicate-email');
      return jsonResponse(200, { valid: false });
    }
    // Log the DB error server-side but don't leak the message to the client.
    // Postgres error strings can include column names, query fragments, and
    // schema details that help an attacker shape follow-up probes.
    // eslint-disable-next-line no-console
    console.error('[shell-login] supabase users lookup error:', userErr.message);
    logShellLogin(req, email, 'failed', 'db-error');
    return jsonResponse(500, { error: 'Database error' });
  }
  if (!user || !user.pin_hash) {
    logShellLogin(req, email, 'failed', 'no-user-or-no-pin');
    void sb.rpc('eq_write_audit_log', { p_event: 'login.failed', p_ip: ip, p_detail: { reason: 'no-user-or-no-pin' } });
    return jsonResponse(200, { valid: false });
  }

  const pinOk = await bcrypt.compare(pin, user.pin_hash);
  if (!pinOk) {
    logShellLogin(req, email, 'failed', 'bad-pin');
    void sb.rpc('eq_write_audit_log', { p_event: 'login.failed', p_ip: ip, p_detail: { reason: 'bad-pin' } });
    return jsonResponse(200, { valid: false });
  }

  // Hydrate tenant + entitlements for the response payload.
  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, tier, active')
    .eq('id', user.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    logShellLogin(req, email, 'failed', tenantErr ? 'tenant-err' : 'tenant-missing-or-inactive');
    return jsonResponse(200, { valid: false });
  }

  const { data: entitlements } = await sb
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  // Best-effort last_login_at bump. Non-blocking: if the update fails
  // (Supabase blip, RLS regression, etc.) the user still gets their
  // session — we just log the issue and move on.
  const { error: lastLoginErr } = await sb
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);
  if (lastLoginErr) {
    // eslint-disable-next-line no-console
    console.warn('[shell-login] last_login_at update failed:', lastLoginErr.message);
  }

  // Clear the rate-limit bucket on successful login so the user's
  // next session starts with a clean slate. Best-effort — non-fatal.
  void sb.rpc('clear_rate_limit', { p_key: rlKey });

  logShellLogin(req, email, 'success');
  void sb.rpc('eq_write_audit_log', { p_event: 'login.success', p_actor_id: user.id, p_tenant_id: tenant.id, p_ip: ip, p_detail: { role: user.role } });

  // Sign the session cookie.
  // Phase 1.F: payload carries the 5-tier role + is_platform_admin so
  // useCan() on the React side reads them from SessionContext without
  // a round-trip; mint-iframe-token (Field bridge) also reads them
  // from the same cookie.
  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: user.id,
    tenant_id: tenant.id,
    role: user.role,
    is_platform_admin: user.is_platform_admin,
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
  const supabaseJwt = signSupabaseJwt(
    user.id,
    tenant.id,
    user.role,
    user.is_platform_admin,
  );

  return jsonResponse(
    200,
    {
      valid: true,
      user: userSafe,
      tenant,
      entitlements: entitlements ?? [],
      supabase_jwt: supabaseJwt,
    },
    { 'Set-Cookie': cookie }
  );
});
