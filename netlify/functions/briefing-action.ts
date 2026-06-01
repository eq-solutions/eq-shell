// POST /.netlify/functions/briefing-action
//
// Records a user's dismiss or done action on an AI briefing action item.
// Invalidates the briefing cache for that user so the next request
// regenerates a fresh brief without the actioned item.
//
// Body: { action_title: string, action_source: string, state: 'actioned' | 'dismissed' }
// Auth: session cookie (same as all other EQ Shell functions)
//
// Response:
//   { ok: true }
//   { ok: false, error: string }

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

const VALID_STATES = new Set(['actioned', 'dismissed']);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const { action_title, action_source, state } = body as Record<string, unknown>;

  if (typeof action_title !== 'string' || !action_title.trim()) {
    return json(400, { ok: false, error: 'action_title_required' });
  }
  if (typeof action_source !== 'string' || !action_source.trim()) {
    return json(400, { ok: false, error: 'action_source_required' });
  }
  if (typeof state !== 'string' || !VALID_STATES.has(state)) {
    return json(400, { ok: false, error: 'state_must_be_actioned_or_dismissed' });
  }

  const { tenant_id: tenantId, user_id: userId } = session;

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    if (e instanceof TenantNotFoundError)       return json(500, { ok: false, error: 'tenant_not_provisioned' });
    if (e instanceof TenantNotActiveError)      return json(503, { ok: false, error: 'tenant_inactive' });
    if (e instanceof TenantRoutingMisconfiguredError) return json(500, { ok: false, error: 'routing_misconfigured' });
    return json(500, { ok: false, error: 'internal_error' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  try {
    // Write the action state record
    const insertRes = await tenantAny
      .schema('app_data')
      .from('briefing_actions')
      .insert({
        tenant_id:     tenantId,
        user_id:       userId,
        action_title:  action_title.trim(),
        action_source: action_source.trim(),
        state,
      });

    if (insertRes.error) {
      console.warn('[briefing-action] insert failed', insertRes.error.message);
      return json(500, { ok: false, error: 'write_failed' });
    }

    // Invalidate briefing cache so next load regenerates without this action
    await tenantAny
      .schema('app_data')
      .from('briefing_cache')
      .delete()
      .eq('user_id', userId);

    return json(200, { ok: true });

  } catch (e) {
    captureServerError(e, { context: 'briefing-action', tenantId });
    console.error('[briefing-action] unexpected error:', (e as Error).message);
    return json(500, { ok: false, error: 'internal_error' });
  }
});
