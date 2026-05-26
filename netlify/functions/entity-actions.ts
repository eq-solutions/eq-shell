// POST /.netlify/functions/entity-actions
//
// Archive, restore, or hard-delete a canonical entity record.
// Called by EntityBrowserPage when a manager clicks Archive / Restore / Delete
// in the detail drawer.
//
// Authentication
//   Session cookie (eq_shell_session) — same as entity-rows.ts.
//   The tenant is resolved from the session, never from the body.
//
// Authorisation
//   Archive / restore: any authenticated user.
//   Delete:           manager or platform_admin only.
//
// Body
//   { entity: 'customer'|'site'|'contact', id: uuid, action: 'archive'|'unarchive'|'delete' }
//
// Response
//   { ok: true, entity, id, action }
//   { ok: false, error: '<code>', detail?: '<human>' }
//
// Implementation
//   Uses the service-role client (getTenantDataClientById) to do direct table
//   operations in app_data — no RPC needed because the Netlify layer already
//   verifies the session and enforces tenant isolation via the routing table.
//   Direct table ops also give cleaner FK error messages than routing through
//   SECURITY DEFINER functions.

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

// ──────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maps entity name → { table, pk } in app_data schema.
// Only the three CRM entities support management actions from the shell.
// Staff, schedule, etc. are managed inside EQ Field.
const ENTITY_META: Record<string, { table: string; pk: string }> = {
  customer: { table: 'customers', pk: 'customer_id' },
  site:     { table: 'sites',     pk: 'site_id'     },
  contact:  { table: 'contacts',  pk: 'contact_id'  },
};

type Action = 'archive' | 'unarchive' | 'delete';
const VALID_ACTIONS = new Set<Action>(['archive', 'unarchive', 'delete']);

// ──────────────────────────────────────────────────────────────────────
// Response helpers
// ──────────────────────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────────

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  // Verify session
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return json(401, { ok: false, error: 'not_signed_in' });
  }

  // Parse body
  let body: { entity?: unknown; id?: unknown; action?: unknown };
  try {
    body = await req.json() as { entity?: unknown; id?: unknown; action?: unknown };
  } catch {
    return json(400, { ok: false, error: 'invalid_body', detail: 'body must be valid JSON' });
  }

  const entity = typeof body.entity === 'string' ? body.entity : '';
  const id     = typeof body.id     === 'string' ? body.id     : '';
  const action = typeof body.action === 'string' ? body.action : '';

  const meta = ENTITY_META[entity];
  if (!meta) {
    return json(400, {
      ok: false, error: 'unknown_entity',
      detail: `entity must be one of: ${Object.keys(ENTITY_META).join(', ')}`,
    });
  }

  if (!UUID_RE.test(id)) {
    return json(400, { ok: false, error: 'invalid_id', detail: 'id must be a valid UUID' });
  }

  if (!VALID_ACTIONS.has(action as Action)) {
    return json(400, {
      ok: false, error: 'invalid_action',
      detail: 'action must be one of: archive, unarchive, delete',
    });
  }

  // Authorisation: delete is manager/admin only
  if (action === 'delete') {
    const role = (session as unknown as { role?: string; is_platform_admin?: boolean });
    const canDelete =
      (role as { role?: string }).role === 'manager' ||
      (role as { is_platform_admin?: boolean }).is_platform_admin === true;
    if (!canDelete) {
      return json(403, {
        ok: false, error: 'forbidden',
        detail: 'Delete requires manager or platform admin role',
      });
    }
  }

  // Resolve tenant data client
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = tenantDb as any;

  // Execute action
  if (action === 'archive' || action === 'unarchive') {
    const { error: dbErr } = await db
      .schema('app_data')
      .from(meta.table)
      .update({ active: action === 'unarchive', updated_at: new Date().toISOString() })
      .eq(meta.pk, id)
      .eq('tenant_id', session.tenant_id);

    if (dbErr) {
      console.error('[entity-actions] update failed', { entity, id, action, error: dbErr.message });
      return json(500, { ok: false, error: 'db_error', detail: dbErr.message });
    }

    return json(200, { ok: true, entity, id, action });
  }

  if (action === 'delete') {
    const { error: dbErr } = await db
      .schema('app_data')
      .from(meta.table)
      .delete()
      .eq(meta.pk, id)
      .eq('tenant_id', session.tenant_id);

    if (dbErr) {
      // FK violation — contacts/sites reference customers; we return a
      // human-friendly message rather than the raw postgres error.
      const isFk =
        dbErr.code === '23503' ||
        dbErr.message.toLowerCase().includes('foreign key') ||
        dbErr.message.toLowerCase().includes('violates');

      if (isFk) {
        return json(409, {
          ok: false, error: 'has_dependents',
          detail: `Cannot delete — archive or reassign linked records first.`,
        });
      }
      console.error('[entity-actions] delete failed', { entity, id, error: dbErr.message });
      return json(500, { ok: false, error: 'db_error', detail: dbErr.message });
    }

    return json(200, { ok: true, entity, id, action });
  }

  // Should never reach here (action already validated above)
  return json(500, { ok: false, error: 'internal_error' });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[entity-actions] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[entity-actions] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
