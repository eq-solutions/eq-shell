// POST /.netlify/functions/mint-cards-iframe-token
//
// Mints a short-lived (15min) Supabase JWT scoped to the current shell
// user, intended to be passed to the Cards iframe via the URL hash:
//
//   https://cards.eq.solutions/#sh=<jwt>
//
// The Cards Flutter app (post-Unit-4 flip) reads the hash, calls
// `Supabase.instance.client.auth.setSession(jwt)`, and is then
// authenticated against canonical with the same tenant + role +
// platform_admin claims the shell carries.
//
// Why not just reuse mint-supabase-jwt directly: this endpoint
// (a) defaults source_app='cards' for audit purposes, (b) returns the
// token in a shape Cards-iframe consumes directly, (c) gives a place
// to enforce iframe-specific policy (e.g. shorter TTL, additional
// claims) without polluting the general mint endpoint.
//
// Spec: eq/cards/canonical-migration/plan.md §Unit 5.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { withSentry } from './_shared/sentry.js';

const CARDS_IFRAME_TTL_SECONDS = 15 * 60; // 15 min

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!hasSecretSalt() || !hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured' });
  }

  const cookieToken = readSessionCookie(req);
  const session = verifySessionToken(cookieToken);
  if (!session) {
    return jsonResponse(401, { valid: false });
  }

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

  if (userErr || !user || user.tenant_id !== session.tenant_id) {
    return jsonResponse(401, { valid: false });
  }

  const { token, jti, exp } = signSupabaseJwt(
    user.id,
    user.tenant_id,
    user.role,
    user.is_platform_admin,
    CARDS_IFRAME_TTL_SECONDS,
    'cards',
  );

  // Record the mint event with token_type='iframe_cards'
  try {
    const sourceIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;
    // .schema('public') is REQUIRED — service client defaults to
    // shell_control (see _shared/supabase.ts). Mirrors the fix in
    // mint-supabase-jwt.ts.
    await sb.schema('public').rpc('eq_record_mint', {
      p_tenant_id: user.tenant_id,
      p_user_id: user.id,
      p_token_type: 'iframe_cards',
      p_jti: jti,
      p_source_app: 'cards',
      p_source_ip: sourceIp,
      p_user_agent: userAgent,
      p_exp_at: new Date(exp * 1000).toISOString(),
    });
  } catch (e) {
    console.warn('[mint-cards-iframe-token] mint audit failed:', (e as Error).message);
  }

  return jsonResponse(200, { token, exp });
});
