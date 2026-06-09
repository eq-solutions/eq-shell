// POST /.netlify/functions/shell-create-provision-token
//
// Platform-admin only. Creates a one-time provision token that an org admin
// can use to self-provision their workspace via the EQ Cards /provision flow.
//
// Body:     { org_name: string }
// Response: { id: string, url: string }
//           url = https://cards.eq.solutions/provision?token=<id>&name=<encoded>
//
// The token is stored in shell_control.provision_tokens and consumed exactly
// once by shell-provision-tenant. Re-using or sharing the link does nothing
// after the first use (used_at is set atomically).

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const CARDS_BASE = 'https://cards.eq.solutions';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Platform admin gate — session cookie required
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  if (!session.is_platform_admin) return jsonResponse(403, { error: 'Platform admin only' });

  let body: { org_name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  const orgName = (body.org_name ?? '').trim();
  if (!orgName) return jsonResponse(400, { error: 'org_name is required' });
  if (orgName.length > 200) return jsonResponse(400, { error: 'org_name too long (max 200 chars)' });

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: token, error } = await sb
    .schema('shell_control')
    .from('provision_tokens')
    .insert({ org_name: orgName, created_by_user_id: session.user_id })
    .select('id')
    .single<{ id: string }>();

  if (error || !token) {
    console.error('[shell-create-provision-token] insert error:', error?.message);
    return jsonResponse(500, { error: error?.message ?? 'Failed to create provision token' });
  }

  const url = `${CARDS_BASE}/provision?token=${token.id}&name=${encodeURIComponent(orgName)}`;
  return jsonResponse(201, { id: token.id, url });
});
