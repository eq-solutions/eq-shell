// POST /.netlify/functions/token-exchange
//
// Phase 2 (C4 shadow mode) — mints a Supabase JWT for an embedded app iframe
// instead of the HMAC token that mint-iframe-token produces.
//
// Request body: { aud: 'field' | 'service', tenant_slug?: string }
//
// This function is the Phase 3 drop-in replacement for mint-iframe-token.
// In Phase 2 it runs alongside the HMAC path; in Phase 3 the HMAC path
// (mint-iframe-token) is retired and this becomes the sole minting endpoint.
//
// The returned JWT:
//   - Signed with SUPABASE_JWT_SECRET (same secret as mint-supabase-jwt)
//   - 60-second TTL to match the HMAC iframe token window
//   - source_app in app_metadata tells the receiving app which surface minted it
//   - Verifiable with verifySupabaseJwt() on any server that knows the secret
//
// Phase 3 receiver updates required (not in this PR):
//   Field  — verify-pin.ts: accept Supabase JWT via `action=verify-supabase-token`
//            (replaces `action=verify-shell-token` that reads the HMAC ShellTokenPayload)
//   Service — shell-auth.ts: accept Supabase JWT Bearer in addition to bridge token
//
// Shadow mode (Phase 2):
//   Set `shadow_jwt_enabled: true` in shell_control.platform_config to route
//   a percentage of sessions through this function for parity logging.
//   The routing logic lives in FieldIframe.tsx / ServiceIframe.tsx.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { withSentry } from './_shared/sentry.js';

const IFRAME_TOKEN_TTL_SECONDS = 60;

const ALLOWED_FIELD_TENANT_SLUGS = ['eq', 'demo-trades', 'melbourne', 'sks'] as const;
type AllowedFieldTenantSlug = (typeof ALLOWED_FIELD_TENANT_SLUGS)[number];

function isAllowedFieldTenantSlug(value: unknown): value is AllowedFieldTenantSlug {
  return typeof value === 'string' && (ALLOWED_FIELD_TENANT_SLUGS as readonly string[]).includes(value);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!hasSecretSalt()) return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  if (!hasSupabaseJwtSecret()) return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });

  const shellToken = readSessionCookie(req);
  const session = verifySessionToken(shellToken);
  if (!session) return jsonResponse(401, { valid: false });

  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body' }); }

  const aud = (body as { aud?: unknown } | null)?.aud ?? 'field';
  if (aud !== 'field' && aud !== 'service') {
    return jsonResponse(400, { error: 'Invalid aud — expected "field" or "service"' });
  }

  let tenantSlug: AllowedFieldTenantSlug | undefined;
  if (aud === 'field') {
    const raw = (body as { tenant_slug?: unknown } | null)?.tenant_slug;
    if (!isAllowedFieldTenantSlug(raw)) {
      return jsonResponse(400, { error: 'Invalid or missing tenant_slug', allowed: ALLOWED_FIELD_TENANT_SLUGS });
    }
    tenantSlug = raw;
  }

  let sb;
  try { sb = getServiceClient(); } catch (e) { return jsonResponse(500, { error: (e as Error).message }); }

  const { data: user, error } = await sb
    .schema('shell_control')
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'email' | 'name' | 'tenant_id' | 'role' | 'is_platform_admin' | 'active'>>();

  if (error || !user) return jsonResponse(401, { valid: false });

  if (aud === 'service' && user.tenant_id !== session.tenant_id) {
    return jsonResponse(401, { valid: false });
  }

  const { token, exp } = signSupabaseJwt(
    user.id,
    user.tenant_id,
    user.role,
    user.is_platform_admin,
    IFRAME_TOKEN_TTL_SECONDS,
    aud === 'field' ? `field:${tenantSlug ?? 'eq'}` : 'service',
    user.email,
  );

  // Log for parity analysis — helps Phase 2 parity check compare
  // Supabase JWT path vs HMAC path for the same user.
  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'token.exchange',
    p_actor_id: user.id,
    p_tenant_id: user.tenant_id,
    p_ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    p_detail: { aud, method: 'supabase-jwt', tenant_slug: tenantSlug ?? null },
  });

  if (aud === 'field') {
    return jsonResponse(200, { token, tenant_slug: tenantSlug, exp });
  }
  return jsonResponse(200, { token, exp });
});
