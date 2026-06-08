// GET /.netlify/functions/cards-connected-workers
//
// Returns active org_memberships for the tenant's organisation,
// joined with worker profile + credentials (non-deleted, active).
//
// Response shape per worker:
//   { membership_id, user_id, phone, first_name, last_name, role,
//     accepted_at, credentials: [{ id, credential_type, licence_number,
//     expiry_date, never_expires, status }] }
//
// Manager + platform_admin only.

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
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });

  if (!can(session, 'admin.review_cards')) {
    return json(403, { error: 'Manager access required' });
  }

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // Find the organisation for this tenant on the canonical plane.
  const { data: org, error: orgErr } = await sb
    .from('organisations')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orgErr) return json(500, { error: orgErr.message });
  if (!org) return json(200, { connected: [] });

  // Fetch active memberships.
  const { data: memberships, error: memErr } = await sb
    .from('org_memberships')
    .select('id, user_id, invited_phone, role, accepted_at')
    .eq('org_id', org.id)
    .eq('status', 'active');

  if (memErr) return json(500, { error: memErr.message });
  if (!memberships || memberships.length === 0) return json(200, { connected: [] });

  // Resolve worker profiles for memberships that have a linked user.
  const userIds = memberships
    .map((m) => m.user_id)
    .filter((id): id is string => id != null);

  const workersByUserId = new Map<
    string,
    { id: string; first_name: string; last_name: string; phone: string | null }
  >();
  const credsByWorkerId = new Map<
    string,
    Array<{
      id: string;
      credential_type: string;
      licence_number: string | null;
      expiry_date: string | null;
      never_expires: boolean;
      status: string;
    }>
  >();

  if (userIds.length > 0) {
    const { data: workers, error: wErr } = await sb
      .from('workers')
      .select('id, user_id, first_name, last_name, phone')
      .in('user_id', userIds);

    if (wErr) return json(500, { error: wErr.message });

    const workerIds: string[] = [];
    for (const w of workers ?? []) {
      if (w.user_id) workersByUserId.set(w.user_id, w);
      workerIds.push(w.id);
    }

    if (workerIds.length > 0) {
      const { data: creds, error: cErr } = await sb
        .from('worker_credentials')
        .select(
          'id, worker_id, credential_type, licence_number, expiry_date, never_expires, status',
        )
        .in('worker_id', workerIds)
        .is('deleted_at', null)
        .eq('status', 'active');

      if (cErr) return json(500, { error: cErr.message });

      for (const c of creds ?? []) {
        const list = credsByWorkerId.get(c.worker_id) ?? [];
        list.push(c);
        credsByWorkerId.set(c.worker_id, list);
      }
    }
  }

  const connected = memberships.map((m) => {
    const worker = m.user_id ? workersByUserId.get(m.user_id) : null;
    const credentials = worker ? (credsByWorkerId.get(worker.id) ?? []) : [];
    return {
      membership_id: m.id,
      user_id: m.user_id ?? null,
      phone: worker?.phone ?? m.invited_phone ?? null,
      first_name: worker?.first_name ?? null,
      last_name: worker?.last_name ?? null,
      role: m.role,
      accepted_at: m.accepted_at ?? null,
      credentials: credentials.map((c) => ({
        id: c.id,
        credential_type: c.credential_type,
        licence_number: c.licence_number ?? null,
        expiry_date: c.expiry_date ?? null,
        never_expires: c.never_expires,
        status: c.status,
      })),
    };
  });

  return json(200, { connected });
});
