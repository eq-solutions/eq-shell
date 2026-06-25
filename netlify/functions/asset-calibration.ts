// POST /.netlify/functions/asset-calibration
//
// Create or update a plant & equipment item's calibration fields. Called by
// the Plant & Equipment shell module (src/modules/equipment).
//
// Authentication
//   Session cookie (eq_shell_session) — same as entity-rows / entity-actions.
//   The tenant is resolved from the session, never from the body.
//
// Authorisation
//   manager / supervisor / platform_admin (the equipment.edit permission).
//
// Body
//   { action: 'create', fields: {...} }              — name + site_id required
//   { action: 'update', id: <asset_id>, fields:{...} }
//
//   fields (all optional unless noted): name, make, model, serial_number,
//   site_id, last_service_date, next_service_due, ppm_frequency, cert_url
//
// Implementation
//   Direct app_data.assets table ops via the service-role tenant client —
//   same rationale as entity-actions.ts (the Netlify layer already verifies
//   the session + enforces tenant isolation; no RPC needed).

import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The asset_type that marks an item as our internal plant & equipment. Both
// the create path (stamp) and the update path (scope guard) use it so this
// endpoint can never mutate a customer asset maintained in EQ Service.
const INTERNAL_ASSET_TYPE = 'plant_equipment';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Whitelist + validate the editable fields. Returns the cleaned subset (only
// keys the caller actually supplied) or an error message.
function cleanFields(raw: Record<string, unknown>): { fields: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  if ('name' in raw)          out.name          = str(raw.name) || null;
  if ('make' in raw)          out.make          = str(raw.make) || null;
  if ('model' in raw)         out.model         = str(raw.model) || null;
  if ('serial_number' in raw) out.serial_number = str(raw.serial_number) || null;
  if ('ppm_frequency' in raw) out.ppm_frequency = str(raw.ppm_frequency) || null;
  // Asset tag (e.g. a calibration cert's "CXS027014"). Freeform; also the
  // (tenant_id, external_id) upsert key, so cert imports backfill it.
  if ('external_id' in raw)   out.external_id   = str(raw.external_id) || null;

  if ('site_id' in raw) {
    const s = str(raw.site_id);
    if (s && !UUID_RE.test(s)) return { fields: out, error: 'site_id must be a UUID' };
    out.site_id = s || null;
  }

  // Custodian (migration 0040). Optional; empty clears the assignment.
  if ('assigned_to' in raw) {
    const s = str(raw.assigned_to);
    if (s && !UUID_RE.test(s)) return { fields: out, error: 'assigned_to must be a UUID' };
    out.assigned_to = s || null;
  }

  for (const key of ['last_service_date', 'next_service_due'] as const) {
    if (key in raw) {
      const s = str(raw[key]);
      if (s && !DATE_RE.test(s)) return { fields: out, error: `${key} must be YYYY-MM-DD` };
      out[key] = s || null;
    }
  }

  if ('cert_url' in raw) {
    const s = str(raw.cert_url);
    if (s && !/^https?:\/\//i.test(s)) return { fields: out, error: 'cert_url must start with http:// or https://' };
    out.cert_url = s || null;
  }

  return { fields: out };
}

export default withSentry(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  // Authorisation: equipment.edit = manager / supervisor / platform_admin.
  if (!can(session, 'equipment.edit')) {
    return json(403, { ok: false, error: 'forbidden', detail: 'Editing equipment requires manager or supervisor.' });
  }

  let body: { action?: unknown; id?: unknown; fields?: unknown };
  try {
    body = (await req.json()) as { action?: unknown; id?: unknown; fields?: unknown };
  } catch {
    return json(400, { ok: false, error: 'invalid_body', detail: 'body must be valid JSON' });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (action !== 'create' && action !== 'update') {
    return json(400, { ok: false, error: 'invalid_action', detail: 'action must be create or update' });
  }

  const rawFields =
    body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, unknown>) : {};
  const { fields, error: fieldErr } = cleanFields(rawFields);
  if (fieldErr) return json(400, { ok: false, error: 'invalid_field', detail: fieldErr });

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = tenantDb as any;
  const now = new Date().toISOString();

  if (action === 'create') {
    if (!fields.name)    return json(400, { ok: false, error: 'missing_field', detail: 'name is required' });
    if (!fields.site_id) return json(400, { ok: false, error: 'missing_field', detail: 'a location (site) is required' });

    const { data, error: dbErr } = await db
      .schema('app_data')
      .from('assets')
      .insert({
        ...fields,
        tenant_id:  session.tenant_id,
        asset_type: INTERNAL_ASSET_TYPE,
        created_by: session.user_id,
        updated_by: session.user_id,
        created_at: now,
        updated_at: now,
      })
      .select('asset_id')
      .single();

    if (dbErr) {
      console.error('[asset-calibration] insert failed', { tenant: session.tenant_id, error: dbErr.message });
      return json(500, { ok: false, error: 'db_error', detail: dbErr.message });
    }
    return json(200, { ok: true, action, id: (data as { asset_id?: string } | null)?.asset_id });
  }

  // update
  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid_id', detail: 'id must be a valid UUID' });
  if (Object.keys(fields).length === 0) {
    return json(400, { ok: false, error: 'no_fields', detail: 'no fields to update' });
  }

  const { data: updated, error: dbErr } = await db
    .schema('app_data')
    .from('assets')
    .update({ ...fields, updated_by: session.user_id, updated_at: now })
    .eq('asset_id', id)
    .eq('tenant_id', session.tenant_id)
    // Scope guard: only OUR plant & equipment. Without this, a valid asset_id
    // for a customer asset (EQ Service — a different asset_type) in the same
    // tenant would be editable here, crossing the our-gear / customer-gear line.
    .eq('asset_type', INTERNAL_ASSET_TYPE)
    .select('asset_id');

  if (dbErr) {
    console.error('[asset-calibration] update failed', { id, tenant: session.tenant_id, error: dbErr.message });
    return json(500, { ok: false, error: 'db_error', detail: dbErr.message });
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    return json(404, { ok: false, error: 'not_found', detail: 'No plant & equipment item with that id.' });
  }
  return json(200, { ok: true, action, id });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[asset-calibration] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[asset-calibration] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
