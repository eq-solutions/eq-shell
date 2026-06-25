// POST /.netlify/functions/mint-sks-jwt
//
// Mints a short-lived JWT valid for sks-canonical (ehowgjardagevnrluult) —
// the SKS tenant data plane. Same claim shape as mint-supabase-jwt but
// signed with SKS_SUPABASE_JWT_SECRET (sks-canonical's JWT secret).
//
// Required env vars:
//   SKS_SUPABASE_JWT_SECRET — sks-canonical's JWT secret
//                             (Supabase dashboard → sks-canonical → Settings → API → JWT Secret)
//
// Response:
//   200 OK { token: string, exp: number }
//   401    { valid: false }
//   500    { error: string }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { signJwtWithSecret } from './_shared/supabase-jwt.js';
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
  if (!SKS_JWT_SECRET) return jsonResponse(500, { error: 'Server misconfigured — missing SKS_SUPABASE_JWT_SECRET' });

  const cookieToken = readSessionCookie(req);
  const session = verifySessionToken(cookieToken);
  if (!session) return jsonResponse(401, { valid: false });

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'role' | 'is_platform_admin' | 'active'>>();

  if (userErr || !user) return jsonResponse(401, { valid: false });
  // No tenant_id cross-check here — platform admins and multi-tenant users have
  // users.tenant_id = home tenant, which differs from session.tenant_id when
  // they are operating as another tenant. The HMAC-verified session already
  // guarantees the tenant is legitimate.

  const ttlSeconds = parseTtl(req);
  const sourceApp = new URL(req.url).searchParams.get('source_app') ?? 'shell';
  const { token, exp } = signJwtWithSecret(
    SKS_JWT_SECRET,
    user.id,
    session.tenant_id,
    user.role,
    user.is_platform_admin,
    ttlSeconds,
    sourceApp,
  );

  return jsonResponse(200, { token, exp });
});
