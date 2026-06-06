// POST /.netlify/functions/select-tenant
//
// Completes a multi-tenant login. shell-login returns a short-lived
// selection_token when the user has more than one membership; the
// client posts that token + the chosen tenant_id here to mint the
// real session cookie.

import type { Context } from '@netlify/functions';
import { getServiceClient, getUserMemberships, getEnrichedMemberships } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement } from './_shared/supabase.js';
import {
  signSessionToken,
  verifyTenantSelectionToken,
  hasSecretSalt,
  DEFAULT_TENANT_CONFIG,
} from './_shared/token.js';
import type { TenantConfig } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { totpEnrollmentDue } from './_shared/totp.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { valid: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt() || !hasSupabaseJwtSecret()) {
    return jsonResponse(500, { valid: false, error: 'server-misconfigured' });
  }

  let body: { user_id?: string; tenant_id?: string; selection_token?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { valid: false, error: 'bad-request' });
  }

  const userId = (body.user_id ?? '').trim();
  const tenantId = (body.tenant_id ?? '').trim();
  const selectionToken = (body.selection_token ?? '').trim();

  if (!userId || !tenantId || !selectionToken) {
    return jsonResponse(400, { valid: false, error: 'bad-request' });
  }

  const verified = verifyTenantSelectionToken(selectionToken);
  if (!verified || verified.user_id !== userId) {
    return jsonResponse(401, { valid: false, error: 'invalid-selection-token' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { valid: false, error: (e as Error).message });
  }

  const { data: user } = await sb
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at, last_active_tenant_id, totp_enrolled_at, created_at')
    .eq('id', userId)
    .eq('active', true)
    .maybeSingle<Omit<CanonicalUser, 'pin_hash' | 'phone'>>();

  if (!user) {
    return jsonResponse(401, { valid: false, error: 'user-not-found' });
  }

  let memberships;
  try {
    memberships = await getUserMemberships(user.id);
  } catch {
    return jsonResponse(500, { valid: false, error: 'server-error' });
  }

  const chosen = memberships.find((m) => m.tenant_id === tenantId);
  if (!chosen) {
    return jsonResponse(403, { valid: false, error: 'not-a-member' });
  }

  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, tier, active')
    .eq('id', tenantId)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr || !tenant || !tenant.active) {
    return jsonResponse(403, { valid: false, error: 'tenant-unavailable' });
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

  void sb
    .from('users')
    .update({ last_login_at: new Date().toISOString(), last_active_tenant_id: tenant.id })
    .eq('id', user.id);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('client-ip')
           ?? 'unknown';
  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'login.success',
    p_actor_id: user.id,
    p_tenant_id: tenant.id,
    p_ip: ip,
    p_detail: { method: 'tenant-selection', role: chosen.role },
  });

  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: user.id,
    tenant_id: tenant.id,
    active_tenant_id: tenant.id,
    role: chosen.role,
    is_platform_admin: user.is_platform_admin,
    memberships: memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role })),
    email: user.email,
    name: user.name ?? null,
    config,
    exp,
  });
  const cookie = buildSessionCookie(req, cookieValue, { maxAgeSeconds: SESSION_TTL_MS / 1000 });
  const { token: supabaseJwt } = signSupabaseJwt(user.id, tenant.id, chosen.role, user.is_platform_admin);

  const userSafe = {
    id: user.id,
    email: user.email,
    name: user.name,
    tenant_id: tenant.id,
    role: chosen.role,
    is_platform_admin: user.is_platform_admin,
    active: user.active,
    last_login_at: user.last_login_at,
  };

  const requires_totp_enrollment = totpEnrollmentDue({
    role: chosen.role,
    isPlatformAdmin: user.is_platform_admin,
    totpEnrolledAt: user.totp_enrolled_at,
    createdAt: user.created_at,
  });

  return jsonResponse(
    200,
    {
      valid: true,
      user: userSafe,
      tenant,
      entitlements,
      config,
      memberships: await getEnrichedMemberships(user.id).catch(() => memberships.map((m) => ({ tenant_id: m.tenant_id, role: m.role }))),
      supabase_jwt: supabaseJwt,
      requires_totp_enrollment,
    },
    { 'Set-Cookie': cookie },
  );
});
