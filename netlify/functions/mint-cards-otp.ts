// POST /.netlify/functions/mint-cards-otp
//
// Generates a GoTrue magic-link token hash for the Cards iframe admin path.
//
// Background: gotrue_dart 2.20.0+ changed setSession() to internally call
// getUser(), which rejects shell-minted custom JWTs because they have no
// auth.sessions row. This endpoint replaces the old mint-cards-iframe-token
// setSession path by using GoTrue's own generateLink. Flutter calls
// auth.verifyOTP(tokenHash: hash, type: OtpType.magiclink), which creates a
// real auth.sessions row and returns a session with a valid refresh_token.
//
// Flow:
//   CardsIframe.tsx receives REQUEST_SHELL_TOKEN postMessage from Flutter
//   → calls this endpoint
//   → returns { token_hash }
//   → CardsIframe posts SHELL_TOKEN_RESPONSE { token_hash } to Flutter
//   → Flutter calls auth.verifyOTP(tokenHash: hash, type: OtpType.magiclink)
//   → GoTrue creates auth.sessions row → session with refresh_token established
//   → onAuthStateChange fires → GoRouter routes to /card

import type { Context } from '@netlify/functions';
import { getServiceClient, getUserMemberships } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';
import { checkShellOrigin } from './_shared/origin-check.js';

async function ensureAuthUser(userId: string, email: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/json',
  };

  const checkRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { headers },
  );
  if (checkRes.ok) return;
  if (checkRes.status !== 404) {
    console.warn('[mint-cards-otp] admin getUser unexpected status:', checkRes.status);
    return;
  }

  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: userId, email, email_confirm: true }),
  });

  if (createRes.ok) return;
  const body = await createRes.text();
  if (!body.includes('already registered') && !body.includes('already exists')) {
    console.warn('[mint-cards-otp] ensureAuthUser failed:', createRes.status, body.slice(0, 200));
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const originBlock = checkShellOrigin(req, 'mint-cards-otp');
  if (originBlock) return originBlock;

  if (!hasSecretSalt()) return jsonResponse(500, { error: 'Server misconfigured' });

  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return jsonResponse(500, { error: 'Server misconfigured' });

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
    .select('id, email, tenant_id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'email' | 'tenant_id' | 'role' | 'is_platform_admin' | 'active'>>();

  if (userErr || !user) return jsonResponse(401, { valid: false });

  let memberships;
  try {
    memberships = await getUserMemberships(user.id);
  } catch {
    return jsonResponse(401, { valid: false });
  }

  const activeMembership = memberships.find((m) => m.tenant_id === session.tenant_id);
  if (!activeMembership) return jsonResponse(401, { valid: false });

  // Ensure auth.users row exists in eq-canonical for this user before
  // generateLink — GoTrue requires the user to exist before issuing tokens.
  try {
    await ensureAuthUser(user.id, user.email);
  } catch (e) {
    console.warn('[mint-cards-otp] ensureAuthUser threw:', (e as Error).message);
  }

  // Generate a magic-link token via GoTrue admin. Flutter uses the
  // hashed_token with auth.verifyOTP — no email is sent (the token is
  // consumed by Flutter before any async mailer fires, and jvkn's auth
  // emails are not configured for the control-plane project).
  const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });

  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    console.error('[mint-cards-otp] generateLink failed:', linkErr?.message ?? 'no hashed_token');
    return jsonResponse(500, { error: 'Session mint failed' });
  }

  return jsonResponse(200, { token_hash: tokenHash });
});
