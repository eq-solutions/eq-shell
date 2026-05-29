// GET /.netlify/functions/equipment-list
//
// Lists this tenant's internal plant & equipment — assets whose
// asset_type = 'plant_equipment' (the marker the Plant & Equipment module
// stamps on every item it creates). Customer equipment maintained in EQ
// Service uses other asset_type values and is excluded here, server-side, so
// it never reaches the browser.
//
// Authentication
//   Session cookie (eq_shell_session). Tenant resolved from the session.
//
// Implementation
//   Direct app_data.assets select via the service-role tenant client (same
//   pattern as entity-actions.ts). select('*') keeps it resilient before
//   migration 0017 lands — cert_url is simply absent until the column exists.

import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

// The asset_type value that marks an item as our internal plant & equipment.
// Must match the value the asset-calibration create path writes.
const INTERNAL_ASSET_TYPE = 'plant_equipment';
const MAX_ROWS = 500;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = tenantDb as any;

  const { data, error } = await db
    .schema('app_data')
    .from('assets')
    .select('*')
    .eq('tenant_id', session.tenant_id)
    .eq('asset_type', INTERNAL_ASSET_TYPE)
    .eq('active', true)
    .order('next_service_due', { ascending: true, nullsFirst: false })
    .limit(MAX_ROWS);

  if (error) {
    console.error('[equipment-list] select failed', { tenant: session.tenant_id, error: error.message });
    return json(500, { ok: false, error: 'db_error', detail: error.message });
  }

  return json(200, { ok: true, rows: data ?? [] });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[equipment-list] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[equipment-list] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
