// GET /.netlify/functions/canonical-events?limit=<n>&entity=<filter>
//
// Returns the most recent canonical_events rows for this tenant's data plane.
// Used by FieldRosterPage to show the live "sentient layer" activity feed.
//
// Auth: session cookie required. field.view permission required.
// Tenant: resolved from session — never from query string.

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  if (!can(session, 'field.view')) {
    return json(403, { ok: false, error: 'forbidden', detail: 'field.view permission required' });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Math.min(parseInt(limitRaw, 10), MAX_LIMIT) : DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) {
    return json(400, { ok: false, error: 'invalid_limit' });
  }

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError) {
      return json(500, { ok: false, error: 'tenant_not_provisioned' });
    }
    if (e instanceof TenantNotActiveError) {
      return json(503, { ok: false, error: 'tenant_inactive' });
    }
    if (e instanceof TenantRoutingMisconfiguredError) {
      console.error('[canonical-events] routing misconfigured', e);
      return json(500, { ok: false, error: 'routing_misconfigured' });
    }
    console.error('[canonical-events] unexpected error', e);
    return json(500, { ok: false, error: 'internal_error' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const { data, error } = await tenantAny
    .schema('app_data')
    .from('canonical_events')
    .select('id, event, app_source, payload, occurred_at')
    .eq('tenant_id', session.tenant_id)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[canonical-events] query failed', { tenant: session.tenant_id, error: error.message });
    return json(500, { ok: false, error: 'query_failed', detail: error.message });
  }

  return json(200, { ok: true, events: data ?? [], limit });
});
