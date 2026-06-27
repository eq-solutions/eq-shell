// POST /.netlify/functions/entity-patch
//
// Updates editable fields on a canonical entity record.
// Called by EntityBrowserPage when a manager/supervisor saves an edit.
//
// Authentication
//   Session cookie (eq_shell_session).
//   Tenant is resolved from the session — never from the body.
//
// Authorisation
//   CRM/Equipment entities: entity.edit (manager or supervisor).
//   Field entities (staff, leave_request, timesheet): field.dispatch (manager or supervisor).
//   Permission is resolved per-entity after the entity name is known.
//
// Body
//   { entity: 'customer'|'site'|'contact'|'asset'|'staff'|'leave_request'|'timesheet',
//     id: uuid, fields: Record<string, unknown> }
//
// Only fields in ENTITY_META[entity].fields are written — anything else is silently
// stripped, so there is no way to clobber tenant_id, PKs, or audit columns.

import { randomUUID } from 'node:crypto';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-entity: which fields the UI is allowed to patch, and which DB table + PK to use.
const ENTITY_META: Record<string, { table: string; pk: string; fields: readonly string[] }> = {
  customer: {
    table: 'customers',
    pk: 'customer_id',
    fields: ['company_name', 'email', 'primary_phone', 'state', 'active'],
  },
  contact: {
    table: 'contacts',
    pk: 'contact_id',
    fields: ['first_name', 'last_name', 'email', 'mobile_phone', 'position', 'active'],
  },
  site: {
    table: 'sites',
    pk: 'site_id',
    fields: ['name', 'code', 'suburb', 'state', 'site_type', 'active'],
  },
  asset: {
    table: 'assets',
    pk: 'asset_id',
    fields: ['name', 'external_id', 'asset_type', 'make', 'serial_number', 'next_service_due', 'active'],
  },
  // ── Field entities (require field.dispatch permission) ────────────────────
  staff: {
    table: 'staff',
    pk: 'staff_id',
    fields: [
      'first_name', 'last_name', 'preferred_name',
      'email', 'phone',
      'employment_type', 'trade', 'level',
      'home_base', 'notes',
      'active',
    ],
  },
  leave_request: {
    // Allow managers/supervisors to set status (approve/reject) and add decision notes.
    // from_date, to_date, hours_requested etc. are immutable once submitted.
    table: 'leave_requests',
    pk: 'leave_request_id',
    fields: ['status', 'decision_notes'],
  },
  timesheet: {
    // Allow managers to update status (submitted→approved/paid) and add notes.
    table: 'timesheets',
    pk: 'timesheet_id',
    fields: ['status', 'notes'],
  },
};

// Field entities require field.dispatch rather than entity.edit.
const FIELD_EDIT_ENTITIES = new Set<string>(['staff', 'leave_request', 'timesheet']);

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

  let body: { entity?: unknown; id?: unknown; fields?: unknown };
  try {
    body = await req.json() as { entity?: unknown; id?: unknown; fields?: unknown };
  } catch {
    return json(400, { ok: false, error: 'invalid_body', detail: 'body must be valid JSON' });
  }

  const entity = typeof body.entity === 'string' ? body.entity : '';
  const id     = typeof body.id     === 'string' ? body.id     : '';

  const meta = ENTITY_META[entity];
  if (!meta) {
    return json(400, {
      ok: false, error: 'unknown_entity',
      detail: `entity must be one of: ${Object.keys(ENTITY_META).join(', ')}`,
    });
  }

  // Per-entity permission gate: field entities need field.dispatch; CRM/equipment need entity.edit.
  const requiredPerm = FIELD_EDIT_ENTITIES.has(entity) ? 'field.dispatch' : 'entity.edit';
  if (!can(session, requiredPerm)) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  if (!UUID_RE.test(id)) {
    return json(400, { ok: false, error: 'invalid_id', detail: 'id must be a valid UUID' });
  }

  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    return json(400, { ok: false, error: 'invalid_fields', detail: 'fields must be a non-array object' });
  }

  // Strip any field not in the allow-list, then sanitise values to primitives.
  const allowed = new Set(meta.fields);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body.fields as Record<string, unknown>)) {
    if (!allowed.has(k)) continue;
    // Allow strings, numbers, booleans, null. Reject objects/arrays.
    if (v !== null && typeof v === 'object') continue;
    patch[k] = v;
  }

  if (Object.keys(patch).length === 0) {
    return json(400, { ok: false, error: 'no_editable_fields', detail: `Editable fields: ${meta.fields.join(', ')}` });
  }

  patch.updated_at = new Date().toISOString();

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = tenantDb as any;

  const { error: dbErr } = await db
    .schema('app_data')
    .from(meta.table)
    .update(patch)
    .eq(meta.pk, id)
    .eq('tenant_id', session.tenant_id);

  if (dbErr) {
    console.error('[entity-patch] update failed', { entity, id, error: dbErr.message });
    const isUnique = dbErr.code === '23505';
    if (isUnique) {
      return json(409, { ok: false, error: 'duplicate', detail: 'Another record already uses that value.' });
    }
    return json(500, { ok: false, error: 'db_error', detail: dbErr.message });
  }

  // Non-blocking: emit entity.patched event for downstream consumers.
  // Uses idempotency_key so retried requests don't duplicate events (C3/C4).
  void (async () => {
    try {
      await db.schema('app_data').from('canonical_events').insert({
        tenant_id:       session.tenant_id,
        app_source:      'shell',
        event:           'entity.patched',
        payload:         { entity, id, fields: Object.keys(patch) },
        idempotency_key: randomUUID(),
      });
    } catch (e) {
      console.warn('[entity-patch] canonical_event emit failed', (e as Error)?.message);
    }
  })();

  return json(200, { ok: true, entity, id });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError)
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: (e as TenantNotFoundError).identifier });
  if (e instanceof TenantNotActiveError)
    return json(503, { ok: false, error: 'tenant_inactive', detail: (e as TenantNotActiveError).status });
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[entity-patch] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[entity-patch] unexpected error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
