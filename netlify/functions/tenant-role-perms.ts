// GET  /.netlify/functions/tenant-role-perms
//   Returns the stored overrides for the active tenant.
//   { ok: true, overrides: Array<{ role, perm_key, enabled }> }
//   The client merges these with the hard-coded defaults from @eq-solutions/roles
//   to show the full effective matrix.
//
// POST { action: 'set', role, perm_key, enabled: boolean }
//   Upsert a tenant-level role override.
//
// POST { action: 'reset', role, perm_key }
//   Delete the override — perm reverts to the roles.json default.
//
// Requires admin.manage_groups (manager-only). Tenant-scoped.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const VALID_ROLES = new Set(['manager', 'supervisor', 'employee', 'apprentice', 'labour_hire']);

const VALID_PERM_KEYS = new Set([
  'admin.list_users', 'admin.invite_user', 'admin.edit_user',
  'admin.deactivate_user', 'admin.review_cards', 'admin.manage_groups',
  'audit.view', 'audit.rollback',
  'entity.view', 'entity.create', 'entity.edit', 'entity.delete',
  'intake.view', 'intake.import', 'intake.commit',
  'equipment.view', 'equipment.edit',
  'reports.view', 'reports.upload', 'reports.generate_briefing',
  'cards.view', 'cards.onboard',
  'service.view', 'service.create', 'service.close',
  'field.view', 'field.dispatch',
  'quotes.view', 'quotes.create', 'quotes.approve',
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'unauthenticated' });
  if (!can(session, 'admin.manage_groups')) return json(403, { ok: false, error: 'forbidden' });

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('tenant_role_overrides')
      .select('role, perm_key, enabled')
      .eq('tenant_id', tenantId);
    if (error) return json(500, { ok: false, error: 'db_error' });
    return json(200, { ok: true, overrides: data ?? [] });
  }

  if (req.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json(400, { ok: false, error: 'bad_json' });
    }

    const action = body.action as string | undefined;

    if (action === 'set') {
      const { role, perm_key, enabled } = body as { role?: string; perm_key?: string; enabled?: unknown };
      if (!role || !VALID_ROLES.has(role)) return json(400, { ok: false, error: 'invalid_role' });
      if (!perm_key || !VALID_PERM_KEYS.has(perm_key)) return json(400, { ok: false, error: 'invalid_perm_key' });
      if (typeof enabled !== 'boolean') return json(400, { ok: false, error: 'invalid_enabled' });

      const { error } = await sb
        .from('tenant_role_overrides')
        .upsert(
          {
            tenant_id: tenantId,
            role,
            perm_key,
            enabled,
            updated_by: session.user_id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,role,perm_key' },
        );
      if (error) return json(500, { ok: false, error: 'db_error' });

      void sb.schema('public').rpc('eq_write_audit_log', {
        p_event: 'access.role_override_set',
        p_actor_id: session.user_id,
        p_tenant_id: tenantId,
        p_ip: 'server',
        p_detail: { role, perm_key, enabled },
      });

      return json(200, { ok: true });
    }

    if (action === 'reset') {
      const { role, perm_key } = body as { role?: string; perm_key?: string };
      if (!role || !VALID_ROLES.has(role)) return json(400, { ok: false, error: 'invalid_role' });
      if (!perm_key || !VALID_PERM_KEYS.has(perm_key)) return json(400, { ok: false, error: 'invalid_perm_key' });

      const { error } = await sb
        .from('tenant_role_overrides')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('role', role)
        .eq('perm_key', perm_key);
      if (error) return json(500, { ok: false, error: 'db_error' });
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: 'unknown_action' });
  }

  return json(405, { ok: false, error: 'method_not_allowed' });
});
