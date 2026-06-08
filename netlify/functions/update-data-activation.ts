// POST /.netlify/functions/update-data-activation
//
// Toggles field_enabled and/or service_enabled on an app_data.sites or
// app_data.customers row for the calling user's tenant.
//
// Request (POST, JSON body):
//   {
//     table:            'sites' | 'customers'
//     id:               string  — site_id or customer_id (UUID)
//     field_enabled?:   boolean
//     service_enabled?: boolean
//   }
//
// Response:
//   200 { ok: true }
//   400 { ok: false, error: 'bad_request',  detail: string }
//   401 { ok: false, error: 'unauthenticated' }
//   403 { ok: false, error: 'forbidden' }      — not a manager
//   500 { ok: false, error: string }
//
// Auth: session must exist + role must be 'manager' or is_platform_admin.
// The update is always scoped to the session's tenant_id — no cross-tenant writes.

import type { Context } from '@netlify/functions';
import { getTenantDataClientById } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const ALLOWED_TABLES = new Set(['sites', 'customers']);

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'unauthenticated' });

  // Only managers (and platform admins) can change which records are active.
  if (session.role !== 'manager' && !session.is_platform_admin) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  let table: string, id: string;
  let fieldEnabled: boolean | undefined;
  let serviceEnabled: boolean | undefined;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    table = String(body.table ?? '');
    id = String(body.id ?? '');
    if (typeof body.field_enabled === 'boolean') fieldEnabled = body.field_enabled;
    if (typeof body.service_enabled === 'boolean') serviceEnabled = body.service_enabled;
  } catch {
    return json(400, { ok: false, error: 'bad_request', detail: 'body must be JSON' });
  }

  if (!ALLOWED_TABLES.has(table)) {
    return json(400, { ok: false, error: 'bad_request', detail: 'table must be "sites" or "customers"' });
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return json(400, { ok: false, error: 'bad_request', detail: 'id must be a valid UUID' });
  }
  if (fieldEnabled === undefined && serviceEnabled === undefined) {
    return json(400, { ok: false, error: 'bad_request', detail: 'must supply field_enabled and/or service_enabled' });
  }

  const updates: Record<string, boolean> = {};
  if (fieldEnabled !== undefined) updates.field_enabled = fieldEnabled;
  if (serviceEnabled !== undefined) updates.service_enabled = serviceEnabled;

  // Primary key column name differs by table.
  const pkCol = table === 'sites' ? 'site_id' : 'customer_id';

  try {
    const db = await getTenantDataClientById(session.tenant_id);
    const { error } = await db
      .schema('app_data')
      .from(table)
      .update(updates)
      .eq(pkCol, id)
      .eq('tenant_id', session.tenant_id); // belt-and-suspenders; RLS also enforces this

    if (error) return json(500, { ok: false, error: 'update_failed', detail: error.message });

    return json(200, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { ok: false, error: 'internal', detail: msg });
  }
});
