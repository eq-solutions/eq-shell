// /.netlify/functions/security-groups
//
// Admin API for security groups — named bundles of extra perm keys.
//
// GET  ?action=list                   — list all groups for the active tenant
// GET  ?action=detail&id=<group_id>   — group detail (perms + members)
// POST { action:'create', name, description? } — create a new group
// POST { action:'delete', id }        — delete a group
// POST { action:'add_perm', id, perm_key }     — add a perm to a group
// POST { action:'remove_perm', id, perm_key }  — remove a perm from a group
// POST { action:'add_member', id, user_id }    — add a user to a group
// POST { action:'remove_member', id, user_id } — remove a user from a group
//
// All operations require admin.manage_groups (manager-only).

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

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

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'list') {
      const { data, error } = await sb
        .from('security_groups')
        .select('id, name, description, created_at')
        .eq('tenant_id', tenantId)
        .order('name');
      if (error) return json(500, { ok: false, error: 'db_error' });
      return json(200, { ok: true, groups: data ?? [] });
    }

    if (action === 'detail') {
      const groupId = url.searchParams.get('id');
      if (!groupId) return json(400, { ok: false, error: 'missing_id' });

      // Verify group belongs to this tenant
      const { data: g, error: gErr } = await sb
        .from('security_groups')
        .select('id, name, description')
        .eq('id', groupId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (gErr || !g) return json(404, { ok: false, error: 'not_found' });

      const [permsRes, membersRes] = await Promise.all([
        sb.from('security_group_perms').select('perm_key').eq('group_id', groupId),
        sb
          .from('user_security_groups')
          .select('user_id, assigned_at')
          .eq('group_id', groupId),
      ]);

      // Resolve user names + emails
      const memberUserIds = ((membersRes.data ?? []) as Array<{ user_id: string; assigned_at: string }>).map(
        (r) => r.user_id,
      );
      const { data: userRows } = memberUserIds.length > 0
        ? await sb
            .schema('shell_control')
            .from('users')
            .select('id, name, email')
            .in('id', memberUserIds)
        : { data: [] };

      const userMap = new Map(
        ((userRows ?? []) as Array<{ id: string; name: string | null; email: string }>).map(
          (u) => [u.id, u],
        ),
      );

      const members = ((membersRes.data ?? []) as Array<{ user_id: string; assigned_at: string }>).map((r) => {
        const u = userMap.get(r.user_id);
        return { user_id: r.user_id, name: u?.name ?? null, email: u?.email ?? '', assigned_at: r.assigned_at };
      });

      return json(200, {
        ok: true,
        group: {
          ...(g as { id: string; name: string; description: string | null }),
          perm_keys: ((permsRes.data ?? []) as Array<{ perm_key: string }>).map((r) => r.perm_key),
          members,
        },
      });
    }

    return json(400, { ok: false, error: 'unknown_action' });
  }

  // ── POST ───────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body: Record<string, unknown>;
    try { body = (await req.json()) as Record<string, unknown>; }
    catch { return json(400, { ok: false, error: 'bad_json' }); }

    const action = body.action as string | undefined;

    if (action === 'create') {
      const name = (body.name as string | undefined)?.trim();
      if (!name) return json(400, { ok: false, error: 'missing_name' });
      const { data, error } = await sb
        .from('security_groups')
        .insert({ tenant_id: tenantId, name, description: body.description ?? null, created_by: session.user_id })
        .select('id, name, description, created_at')
        .single();
      if (error) {
        if (error.code === '23505') return json(409, { ok: false, error: 'name_taken' });
        return json(500, { ok: false, error: 'db_error' });
      }
      return json(201, { ok: true, group: data });
    }

    if (action === 'delete') {
      const id = body.id as string | undefined;
      if (!id) return json(400, { ok: false, error: 'missing_id' });
      const { error } = await sb
        .from('security_groups')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) return json(500, { ok: false, error: 'db_error' });
      return json(200, { ok: true });
    }

    if (action === 'add_perm') {
      const { id, perm_key } = body as { id?: string; perm_key?: string };
      if (!id || !perm_key) return json(400, { ok: false, error: 'missing_fields' });
      // Verify group belongs to tenant
      const { data: g } = await sb.from('security_groups').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (!g) return json(404, { ok: false, error: 'not_found' });
      const { error } = await sb.from('security_group_perms').upsert({ group_id: id, perm_key });
      if (error) return json(500, { ok: false, error: 'db_error' });
      return json(200, { ok: true });
    }

    if (action === 'remove_perm') {
      const { id, perm_key } = body as { id?: string; perm_key?: string };
      if (!id || !perm_key) return json(400, { ok: false, error: 'missing_fields' });
      const { data: g } = await sb.from('security_groups').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (!g) return json(404, { ok: false, error: 'not_found' });
      const { error } = await sb.from('security_group_perms').delete().eq('group_id', id).eq('perm_key', perm_key);
      if (error) return json(500, { ok: false, error: 'db_error' });
      return json(200, { ok: true });
    }

    if (action === 'add_member') {
      const { id, user_id } = body as { id?: string; user_id?: string };
      if (!id || !user_id) return json(400, { ok: false, error: 'missing_fields' });
      const { data: g } = await sb.from('security_groups').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (!g) return json(404, { ok: false, error: 'not_found' });
      const { error } = await sb.from('user_security_groups').upsert({ user_id, group_id: id, assigned_by: session.user_id });
      if (error) return json(500, { ok: false, error: 'db_error' });
      return json(200, { ok: true });
    }

    if (action === 'remove_member') {
      const { id, user_id } = body as { id?: string; user_id?: string };
      if (!id || !user_id) return json(400, { ok: false, error: 'missing_fields' });
      const { data: g } = await sb.from('security_groups').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (!g) return json(404, { ok: false, error: 'not_found' });
      const { error } = await sb.from('user_security_groups').delete().eq('group_id', id).eq('user_id', user_id);
      if (error) return json(500, { ok: false, error: 'db_error' });
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: 'unknown_action' });
  }

  return json(405, { ok: false, error: 'method_not_allowed' });
});
