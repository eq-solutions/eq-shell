// POST /.netlify/functions/mint-tenant-jwt
//
// Mints a short-lived JWT for the SESSION tenant's data plane and returns that
// plane's URL + anon key, resolved from shell_control.tenant_routing. This lets
// a single browser build talk to whatever tenant is signed in, instead of a
// hardcoded plane (the mint-sks-jwt special case it generalises).
//
// Signing secret: the shared SUPABASE_JWT_SECRET, which is configured on every
// tenant data plane (see docs/ARCHITECTURE-V2.md — "one JWT minted by Shell is
// verifiable by any tenant DB"). The SKS plane (ehow) is still on its own secret
// during the canonical cutover, so for tenant 'sks' we sign with
// SKS_SUPABASE_JWT_SECRET — byte-for-byte the same token mint-sks-jwt produces.
// Drop that branch once ehow's JWT secret is aligned to the shared one.
//
// Response:
//   200 OK { token: string, exp: number, url: string, anon_key: string }
//   401    { valid: false }
//   500    { error: string }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { signJwtWithSecret, signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { getRoutingById } from './_shared/tenant-routing.js';
import { withSentry } from './_shared/sentry.js';

const SKS_JWT_SECRET = process.env.SKS_SUPABASE_JWT_SECRET ?? '';

const DEFAULT_TTL = 15 * 60;
const MIN_TTL = 60;
const MAX_TTL = 15 * 60;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function parseTtl(req: Request): number {
  const raw = new URL(req.url).searchParams.get('ttl');
  if (!raw) return DEFAULT_TTL;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TTL;
  return Math.max(MIN_TTL, Math.min(MAX_TTL, Math.floor(n)));
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  if (!hasSecretSalt()) return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return jsonResponse(401, { valid: false });

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, tenant_id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'tenant_id' | 'role' | 'is_platform_admin' | 'active'>>();

  if (userErr || !user) return jsonResponse(401, { valid: false });
  if (user.tenant_id !== session.tenant_id) return jsonResponse(401, { valid: false });

  // Resolve the caller's own tenant plane (URL + anon key) from tenant_routing.
  let routing;
  try {
    routing = await getRoutingById(user.tenant_id, true);
  } catch (e) {
    return jsonResponse(500, { error: `tenant routing: ${(e as Error).message}` });
  }

  const ttlSeconds = parseTtl(req);
  const sourceApp = new URL(req.url).searchParams.get('source_app') ?? 'shell';

  let token: string;
  let exp: number;
  if (routing.tenant_slug === 'sks' && SKS_JWT_SECRET) {
    // Transitional: ehow still validates its own secret. Identical claim shape.
    ({ token, exp } = signJwtWithSecret(
      SKS_JWT_SECRET,
      user.id,
      user.tenant_id,
      user.role,
      user.is_platform_admin,
      ttlSeconds,
      sourceApp,
    ));
  } else {
    if (!hasSupabaseJwtSecret()) {
      return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
    }
    ({ token, exp } = signSupabaseJwt(
      user.id,
      user.tenant_id,
      user.role,
      user.is_platform_admin,
      ttlSeconds,
      sourceApp,
    ));
  }

  return jsonResponse(200, {
    token,
    exp,
    url: routing.supabase_url,
    anon_key: routing.supabase_anon_key,
  });
});
