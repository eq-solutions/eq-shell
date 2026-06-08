// POST /.netlify/functions/entity-insert
//
// Inserts a new canonical entity record into the tenant data plane.
// Called by EntityBrowserPage when a manager creates a new record.
//
// Authentication
//   Session cookie (eq_shell_session).
//   tenant_id is injected server-side from the session — never trusted from body.
//
// Authorisation
//   Requires entity.create (manager only).
//
// Body
//   { entity: 'customer'|'site'|'contact', fields: Record<string, unknown> }
//
// Response
//   { ok: true, entity, id }   — id is the new record's PK UUID
//   { ok: false, error, detail? }

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

// Create is scoped to CRM entities — assets are managed via Service/Intake.
const ENTITY_META: Record<string, { table: string; pk: string; required: readonly string[]; allowed: readonly string[] }> = {
  customer: {
    table: 'customers',
    pk: 'customer_id',
    required: ['company_name'],
    allowed: ['company_name', 'email', 'primary_phone', 'state', 'active'],
  },
  contact: {
    table: 'contacts',
    pk: 'contact_id',
    required: ['first_name', 'last_name'],
    allowed: ['first_name', 'last_name', 'email', 'mobile_phone', 'position'],
  },
  site: {
    table: 'sites',
    pk: 'site_id',
    required: ['name'],
    allowed: ['name', 'code', 'suburb', 'state', 'site_type'],
  },
};

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

  if (!can(session, 'entity.create')) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  let body: { entity?: unknown; fields?: unknown };
  try {
    body = await req.json() as { entity?: unknown; fields?: unknown };
  } catch {
    return json(400, { ok: false, error: 'invalid_body', detail: 'body must be valid JSON' });
  }

  const entity = typeof body.entity === 'string' ? body.entity : '';
  const meta = ENTITY_META[entity];
  if (!meta) {
    return json(400, {
      ok: false, error: 'unknown_entity',
      detail: `entity must be one of: ${Object.keys(ENTITY_META).join(', ')}`,
    });
  }

  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    return json(400, { ok: false, error: 'invalid_fields', detail: 'fields must be a non-array object' });
  }

  const allowed = new Set(meta.allowed);
  const insert: Record<string, unknown> = { tenant_id: session.tenant_id, active: true };

  for (const [k, v] of Object.entries(body.fields as Record<string, unknown>)) {
    if (!allowed.has(k)) continue;
    if (v !== null && typeof v === 'object') continue;
    insert[k] = v;
  }

  for (const req of meta.required) {
    if (!insert[req] || String(insert[req]).trim() === '') {
      return json(400, { ok: false, error: 'missing_required', detail: `${req} is required` });
    }
  }

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = tenantDb as any;

  const { data, error: dbErr } = await db
    .schema('app_data')
    .from(meta.table)
    .insert(insert)
    .select(meta.pk)
    .single();

  if (dbErr) {
    console.error('[entity-insert] insert failed', { entity, error: dbErr.message });
    const isUnique = dbErr.code === '23505';
    if (isUnique) {
      return json(409, { ok: false, error: 'duplicate', detail: 'A record with those details already exists.' });
    }
    return json(500, { ok: false, error: 'db_error', detail: dbErr.message });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newId = (data as any)[meta.pk] as string;

  // Non-blocking: emit entity.inserted event for downstream consumers (C4).
  void (db.schema('app_data').from('canonical_events').insert({
    tenant_id:       session.tenant_id,
    app_source:      'shell',
    event:           'entity.inserted',
    payload:         { entity, id: newId },
    idempotency_key: randomUUID(),
  }) as Promise<unknown>).catch((e: unknown) => {
    console.warn('[entity-insert] canonical_event emit failed', (e as Error)?.message);
  });

  return json(201, { ok: true, entity, id: newId });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError)
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: (e as TenantNotFoundError).identifier });
  if (e instanceof TenantNotActiveError)
    return json(503, { ok: false, error: 'tenant_inactive', detail: (e as TenantNotActiveError).status });
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[entity-insert] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[entity-insert] unexpected error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
