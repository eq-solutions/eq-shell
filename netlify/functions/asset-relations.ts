// GET /.netlify/functions/asset-relations?id=<asset_id>
//
// Returns an asset's hierarchy neighbours: its parent (if parent_asset_id is
// set) and its direct children. Used by the asset detail drawer to show the
// SimPRO-style asset tree (e.g. a breaker inside a switchboard).
//
// Auth: session cookie (eq_shell_session) — same as entity-rows / entity-actions.
// Tenant is resolved from the session, never the body.

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'asset_id, name, external_id, asset_type, active';

interface AssetLite {
  asset_id: string;
  name: string | null;
  external_id: string | null;
  asset_type: string | null;
  active: boolean | null;
}

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

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid_id' });

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = tenantDb as any;

  // Self row → to learn its parent_asset_id.
  const selfRes = await db
    .schema('app_data').from('assets')
    .select('parent_asset_id')
    .eq('asset_id', id).eq('tenant_id', session.tenant_id)
    .maybeSingle();
  if (selfRes.error) {
    console.error('[asset-relations] self lookup failed', { id, error: selfRes.error.message });
    return json(500, { ok: false, error: 'db_error', detail: selfRes.error.message });
  }

  const parentId = (selfRes.data?.parent_asset_id as string | null) ?? null;

  const [parentRes, childrenRes] = await Promise.all([
    parentId
      ? db.schema('app_data').from('assets').select(COLS)
          .eq('asset_id', parentId).eq('tenant_id', session.tenant_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.schema('app_data').from('assets').select(COLS)
      .eq('parent_asset_id', id).eq('tenant_id', session.tenant_id)
      .order('name', { ascending: true }).limit(200),
  ]);

  if (childrenRes.error) {
    console.error('[asset-relations] children query failed', { id, error: childrenRes.error.message });
    return json(500, { ok: false, error: 'db_error', detail: childrenRes.error.message });
  }

  return json(200, {
    ok: true,
    parent: (parentRes.data as AssetLite | null) ?? null,
    children: (childrenRes.data as AssetLite[] | null) ?? [],
  });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  if (e instanceof TenantNotActiveError) return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[asset-relations] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[asset-relations] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
