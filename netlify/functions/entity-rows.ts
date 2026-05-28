// GET /.netlify/functions/entity-rows?entity=<name>&limit=<n>&offset=<n>[&search=<q>&sort_col=<col>&sort_dir=ASC|DESC]
//
// Generic per-entity row lookup used by EntityBrowserPage. Pulls rows from
// the tenant data plane via the eq_browse_entity RPC, returns them in the
// same { rows, total } shape the browser already consumes.
//
// Session-authed via the eq_shell_session cookie. Tenant resolved from
// session.tenant_id; not honoured from query string (would let any
// signed-in user browse any tenant's data).

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

// Allow-list mirrors the RPC's CASE. Reject early so a typo doesn't reach
// the database — saves a round trip and gives a clearer error.
const ALLOWED_ENTITIES = new Set<string>([
  'customer', 'contact', 'site', 'staff',
  'schedule', 'timesheet', 'leave_request', 'tender',
  'prestart', 'toolbox_talk', 'licence', 'asset',
]);

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface RpcRow {
  row_json:    Record<string, unknown>;
  total_count: number;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  const url = new URL(req.url);
  const entity = url.searchParams.get('entity') ?? '';
  if (!ALLOWED_ENTITIES.has(entity)) {
    return json(400, {
      ok: false,
      error: 'unknown_entity',
      detail: `entity must be one of: ${[...ALLOWED_ENTITIES].join(', ')}`,
    });
  }

  const limitRaw  = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');
  const limit  = limitRaw  ? parseInt(limitRaw, 10)  : DEFAULT_LIMIT;
  const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
  if (!Number.isFinite(limit)  || limit  < 1 || limit  > MAX_LIMIT) {
    return json(400, { ok: false, error: 'invalid_filter', detail: `limit must be 1..${MAX_LIMIT}` });
  }
  if (!Number.isFinite(offset) || offset < 0) {
    return json(400, { ok: false, error: 'invalid_filter', detail: 'offset must be >= 0' });
  }

  const search     = url.searchParams.get('search')    ?? undefined;
  const sortCol    = url.searchParams.get('sort_col')   ?? undefined;
  const sortDirRaw = (url.searchParams.get('sort_dir') ?? '').toUpperCase();
  const sortDir    = sortDirRaw === 'ASC' ? 'ASC' : sortDirRaw === 'DESC' ? 'DESC' : undefined;
  const activeRaw  = url.searchParams.get('active');
  const active     = activeRaw === 'true' ? true : activeRaw === 'false' ? false : undefined;

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const rpcParams: Record<string, unknown> = {
    p_entity:    entity,
    p_tenant_id: session.tenant_id,
    p_limit:     limit,
    p_offset:    offset,
  };
  if (search  !== undefined) rpcParams.p_search   = search;
  if (sortCol !== undefined) rpcParams.p_sort_col  = sortCol;
  if (sortDir !== undefined) rpcParams.p_sort_dir  = sortDir;
  if (active  !== undefined) rpcParams.p_active    = active;

  const { data, error } = await tenantAny
    .schema('public')
    .rpc('eq_browse_entity', rpcParams);

  if (error) {
    console.error('[entity-rows] rpc failed', { entity, tenant: session.tenant_id, error: error.message });
    return json(500, { ok: false, error: 'rpc_failed', detail: error.message });
  }

  const rpcRows = (data ?? []) as RpcRow[];
  const rows = rpcRows.map((r) => r.row_json);
  const total = rpcRows.length > 0 ? Number(rpcRows[0].total_count) : 0;

  return json(200, {
    ok:     true,
    entity,
    limit,
    offset,
    total,
    rows,
    search:   search   ?? null,
    sort_col: sortCol  ?? 'created_at',
    sort_dir: sortDir  ?? 'DESC',
    active:   active   ?? null,
  });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[entity-rows] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[entity-rows] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
