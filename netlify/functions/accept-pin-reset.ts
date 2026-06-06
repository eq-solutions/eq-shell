// POST /.netlify/functions/accept-pin-reset
//
// Public endpoint — the reset token IS the authentication.
// User submits their new PIN; on success they're signed in.
//
// Body: { reset_token: string, pin: string }
//
// Response:
//   200 OK { valid: true, user, tenant, entitlements, supabase_jwt }
//           with Set-Cookie: eq_shell_session=...
//   400    { valid: false, error: 'bad-request' | 'bad-pin' }
//   404    { valid: false, error: 'token-not-found-or-expired' }
//   500    { valid: false, error: 'server-error' }

import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import type { Context } from '@netlify/functions';
import { getServiceClient, getUserMemberships } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import { signSessionToken, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;

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

function isValidPin(pin: string): boolean {
  if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) return false;
  return /^[A-Za-z0-9]+$/.test(pin);
}

interface ResetTokenRow {
  id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { valid: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt() || !hasSupabaseJwtSecret()) {
    return jsonResponse(500, { valid: false, error: 'server-misconfigured' });
  }

  let body: { reset_token?: string; pin?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { valid: false, error: 'bad-request' });
  }

  const rawToken = (body.reset_token ?? '').trim();
  const pin = (body.pin ?? '').trim();

  if (!rawToken) {
    return jsonResponse(400, { valid: false, error: 'bad-request' });
  }
  if (!isValidPin(pin)) {
    // Generic response — don't let an attacker distinguish "bad PIN format"
    // from "bad reset token" by status code or error string.
    return jsonResponse(400, { valid: false, error: 'invalid-reset' });
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { valid: false, error: (e as Error).message });
  }

  const { data: tokenRow } = await sb
    .schema('shell_control')
    .from('pin_reset_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle<ResetTokenRow>();

  if (!tokenRow) {
    return jsonResponse(400, { valid: false, error: 'invalid-reset' });
  }

  const { data: user } = await sb
    .from('users')
    .select('id, email, tenant_id, role, is_platform_admin, active')
    .eq('id', tokenRow.user_id)
    .eq('active', true)
    .maybeSingle<Omit<CanonicalUser, 'pin_hash' | 'last_login_at' | 'name'>>();

  if (!user) {
    return jsonResponse(400, { valid: false, error: 'invalid-reset' });
  }

  const pinHash = await bcrypt.hash(pin, 12);

  const { error: updateErr } = await sb
    .from('users')
    .update({ pin_hash: pinHash, last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  if (updateErr) {
    // eslint-disable-next-line no-console
    console.error('[accept-pin-reset] pin update failed:', updateErr.message);
    return jsonResponse(500, { valid: false, error: 'server-error' });
  }

  await sb
    .schema('shell_control')
    .from('pin_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('client-ip')
           ?? 'unknown';
  void sb.schema('public').rpc('eq_write_audit_log', { p_event: 'pin.reset.accepted', p_actor_id: user.id, p_tenant_id: user.tenant_id, p_ip: ip, p_detail: {} });

  const { data: tenant } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, active')
    .eq('id', user.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (!tenant || !tenant.active) {
    return jsonResponse(500, { valid: false, error: 'server-error' });
  }

  const { data: entitlements } = await sb
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  let memberships;
  try {
    memberships = await getUserMemberships(user.id);
  } catch {
    memberships = [{ user_id: user.id, tenant_id: tenant.id, role: user.role, active: true }];
  }
  if (memberships.length === 0) {
    memberships = [{ user_id: user.id, tenant_id: tenant.id, role: user.role, active: true }];
  }
  const activeMembership = memberships.find((m) => m.tenant_id === tenant.id) ?? memberships[0];

  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: user.id,
    tenant_id: tenant.id,
    active_tenant_id: tenant.id,
    role: activeMembership.role,
    is_platform_admin: user.is_platform_admin,
    memberships: memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role })),
    config: DEFAULT_TENANT_CONFIG,
    exp,
  });
  const cookie = buildSessionCookie(req, cookieValue, { maxAgeSeconds: SESSION_TTL_MS / 1000 });
  const { token: supabaseJwt } = signSupabaseJwt(user.id, tenant.id, activeMembership.role, user.is_platform_admin);

  return jsonResponse(
    200,
    {
      valid: true,
      user,
      tenant,
      entitlements: entitlements ?? [],
      memberships: memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role })),
      supabase_jwt: supabaseJwt,
    },
    { 'Set-Cookie': cookie },
  );
});
