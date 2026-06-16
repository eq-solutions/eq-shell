// GET  /.netlify/functions/user-preferences
//   → { ok: true, preferences: Record<string, unknown> }
//
// PATCH /.netlify/functions/user-preferences
//   Body: { key: string; value: unknown }
//   → { ok: true }
//
// Reads and writes the `preferences` jsonb column on shell_control.users.
// Scoped to the authenticated session user only — no cross-user access.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'PATCH') return json(405, { ok: false, error: 'method_not_allowed' });

  const cookie = readSessionCookie(req);
  if (!cookie) return json(401, { ok: false, error: 'no_session' });

  let session: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    session = await verifySessionToken(cookie);
  } catch {
    return json(401, { ok: false, error: 'invalid_session' });
  }
  if (!session) return json(401, { ok: false, error: 'invalid_session' });

  const db = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('users')
      .select('preferences')
      .eq('id', session.user_id)
      .single();

    if (error || !data) return json(500, { ok: false, error: 'read_failed' });
    return json(200, { ok: true, preferences: data.preferences as Record<string, unknown> });
  }

  // PATCH — merge a single key into preferences
  let body: { key?: string; value?: unknown };
  try {
    body = await req.json() as { key?: string; value?: unknown };
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const { key, value } = body;
  if (!key || typeof key !== 'string') return json(400, { ok: false, error: 'key_required' });

  // Read current, merge, write back — safe for low-concurrency user pref writes
  const { data: current, error: readErr } = await db
    .from('users')
    .select('preferences')
    .eq('id', session.user_id)
    .single();

  if (readErr || !current) return json(500, { ok: false, error: 'read_failed' });

  const merged = { ...(current.preferences as Record<string, unknown>), [key]: value };

  const { error: writeErr } = await db
    .from('users')
    .update({ preferences: merged })
    .eq('id', session.user_id);

  if (writeErr) return json(500, { ok: false, error: 'write_failed' });

  return json(200, { ok: true });
});
