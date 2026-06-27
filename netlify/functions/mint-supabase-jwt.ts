// POST /.netlify/functions/mint-supabase-jwt
//
// Phase 1.F — on-demand Supabase JWT minter.
//
// Requires a valid eq_shell_session cookie (the 7-day HMAC). Returns
// a short-lived (default 15min) Supabase-format JWT carrying the
// user's tenant_id + eq_role + is_platform_admin under app_metadata.
//
// External callers (Cards Flutter app, future native iOS app, etc.)
// hit this endpoint to refresh their Supabase auth token before its
// TTL expires. In-shell code can use the same endpoint via the
// `src/lib/supabaseJwt.ts` helper.
//
// Response:
//
//   200 OK { token: string, exp: number }   // exp = unix seconds
//   401      { valid: false }               // no/bad cookie OR inactive user
//
// Query params:
//
//   ?ttl=<seconds>   Override the default 15-minute TTL.
//                    Clamped to [60, 900]. Used to mint shorter-lived
//                    tokens for sensitive paths. Cannot extend beyond
//                    the 15-minute ceiling — extending would defeat
//                    the short-TTL security posture.
//
// Spec: IDENTITY-MODEL.md §6.2 + PHASE-1F-PLAN.md §4.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { withSentry } from './_shared/sentry.js';
import { checkShellOrigin } from './_shared/origin-check.js';

const DEFAULT_TTL_SECONDS = 15 * 60; // 15 min — matches supabase-jwt.ts default
const MIN_TTL_SECONDS = 60;          // 1 min floor — anything shorter is just churn
const MAX_TTL_SECONDS = 15 * 60;     // 15 min ceiling — clamp aggressive callers

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function parseTtl(req: Request): number {
  const url = new URL(req.url);
  const raw = url.searchParams.get('ttl');
  if (!raw) return DEFAULT_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TTL_SECONDS;
  // Clamp: never less than MIN, never more than MAX. The MAX clamp is
  // the security guarantee — even a buggy/malicious caller can't get
  // a longer-lived token by asking nicely.
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.floor(n)));
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  // POST only — minting is a state-shifting-ish op (audit-loggable) so
  // GET would be semantically wrong + CSRF-risky.
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }
  // Cross-subdomain CSRF guard — eq_shell_session is Domain=.eq.solutions;
  // a sibling page could POST here and walk out with a 15-min Supabase JWT.
  const originBlock = checkShellOrigin(req, 'mint-supabase-jwt');
  if (originBlock) return originBlock;

  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
  }

  const cookieToken = readSessionCookie(req);
  const session = verifySessionToken(cookieToken);
  if (!session) {
    return jsonResponse(401, { valid: false });
  }

  // We could trust the cookie payload entirely (it already carries role
  // + is_platform_admin post-1.F), but a fresh DB read catches:
  //   - users.active = false (admin deactivated them since last login)
  //   - role + is_platform_admin changed since last verify
  // The cost is one round-trip to canonical per JWT mint. Acceptable —
  // the client caches the resulting JWT for ~14 minutes (default TTL
  // minus 1 min refresh buffer).
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

  if (userErr || !user) {
    return jsonResponse(401, { valid: false });
  }

  // Defensive: cookie says tenant A, DB says tenant B → tenant was
  // moved or cookie was tampered with. Reject; force re-login.
  if (user.tenant_id !== session.tenant_id) {
    return jsonResponse(401, { valid: false });
  }

  const ttlSeconds = parseTtl(req);
  const sourceApp = new URL(req.url).searchParams.get('source_app') ?? 'shell';
  const { token, jti, exp } = signSupabaseJwt(
    user.id,
    user.tenant_id,
    user.role,
    user.is_platform_admin,
    ttlSeconds,
    sourceApp,
  );

  // S2.D — record the mint event in shell_control.mint_audit_log.
  // Best-effort: failure here doesn't block the response.
  try {
    const sourceIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;
    // .schema('public') is REQUIRED: the service client's default schema
    // is 'shell_control' (set in _shared/supabase.ts), so a plain
    // sb.rpc('eq_record_mint') looks for shell_control.eq_record_mint
    // (which doesn't exist) and 404s silently into our try/catch.
    await sb.schema('public').rpc('eq_record_mint', {
      p_tenant_id: user.tenant_id,
      p_user_id: user.id,
      p_token_type: 'supabase_jwt',
      p_jti: jti,
      p_source_app: sourceApp,
      p_source_ip: sourceIp,
      p_user_agent: userAgent,
      p_exp_at: new Date(exp * 1000).toISOString(),
    });
  } catch (e) {
    // Audit failure shouldn't block the user. Log + continue.
    console.warn('[mint-supabase-jwt] mint audit failed:', (e as Error).message);
  }

  return jsonResponse(200, { token, exp });
});
