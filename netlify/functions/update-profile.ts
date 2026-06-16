// POST /.netlify/functions/update-profile
//
// Self-serve profile edit. Lets a signed-in user change their own
// display name (shell_control.users.name). Scoped strictly to the
// session user — never touches another user's row.
//
// Requires: valid eq_shell_session cookie + { name: string } body.
//
// Response:
//   200 { ok: true, name }
//   400 { ok: false, error: 'bad-request' | 'bad-name' }
//   401 { ok: false, error: 'unauthorized' }
//   500 { ok: false, error: string }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const MAX_NAME_LENGTH = 120;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { ok: false, error: 'server-misconfigured' });
  }

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  let body: { name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  const name = (body.name ?? '').trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    return jsonResponse(400, { ok: false, error: 'bad-name', hint: 'Enter your name (up to 120 characters).' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  // Scoped to the session user ONLY — the WHERE clause is the security
  // boundary; there is no path here to edit anyone else's row.
  const { data: updated, error: updErr } = await sb
    .from('users')
    .update({ name })
    .eq('id', session.user_id)
    .select('name')
    .maybeSingle<Pick<CanonicalUser, 'name'>>();

  if (updErr) {
    // eslint-disable-next-line no-console
    console.error('[update-profile] name update failed:', updErr.message);
    return jsonResponse(500, { ok: false, error: 'server-error' });
  }
  if (!updated) {
    // Session valid but no matching active row — treat as auth failure.
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  return jsonResponse(200, { ok: true, name: updated.name });
});
