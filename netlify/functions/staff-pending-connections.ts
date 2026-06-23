// GET /.netlify/functions/staff-pending-connections
//
// Returns worker-initiated org_access_requests that are still pending for
// this tenant's org, joined with worker profile + licence count from canonical.
//
// Used by StaffPage to show inline approve/decline — replacing the Cards Feed
// for the common case of a worker requesting to connect.
//
// admin.review_cards permission required.

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
  if (!can(session, 'admin.review_cards')) return json(403, { error: 'Manager access required' });

  const sb = getServiceClient();
  const tenantId = session.tenant_id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbPublic = (sb as any).schema('public');

  const { data: org } = (await sbPublic
    .from('organisations')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle()) as { data: { id: string } | null };

  if (!org) return json(200, { pending: [] });

  const { data: appRows, error: appErr } = (await sbPublic
    .from('org_access_requests')
    .select('id, worker_user_id, worker_phone, requested_at, requested_by')
    .eq('org_id', org.id)
    .eq('status', 'pending')
    .not('worker_user_id', 'is', null)) as {
    data: Array<{
      id: string;
      worker_user_id: string;
      worker_phone: string | null;
      requested_at: string;
      requested_by: string;
    }> | null;
    error: { message: string } | null;
  };

  if (appErr) return json(500, { error: appErr.message });

  const workerInitiated = (appRows ?? []).filter(
    (a) => a.requested_by === a.worker_user_id,
  );
  if (workerInitiated.length === 0) return json(200, { pending: [] });

  const userIds = workerInitiated.map((a) => a.worker_user_id);

  const { data: workers } = (await sbPublic
    .from('workers')
    .select('user_id, first_name, last_name, phone')
    .in('user_id', userIds)) as {
    data: Array<{
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
    }> | null;
  };

  const workerMap = new Map<string, (typeof workers)[0]>();
  for (const w of workers ?? []) workerMap.set(w.user_id, w);

  // Licence counts from canonical (public.licences, not worker_credentials)
  const licCountMap = new Map<string, number>();
  const { data: lics } = (await sbPublic
    .from('licences')
    .select('user_id')
    .in('user_id', userIds)
    .is('deleted_at', null)) as { data: Array<{ user_id: string }> | null };

  for (const l of lics ?? []) {
    licCountMap.set(l.user_id, (licCountMap.get(l.user_id) ?? 0) + 1);
  }

  const pending = workerInitiated.map((a) => {
    const w = workerMap.get(a.worker_user_id);
    return {
      application_id: a.id,
      worker_user_id: a.worker_user_id,
      first_name:     w?.first_name ?? null,
      last_name:      w?.last_name  ?? null,
      phone:          w?.phone ?? a.worker_phone ?? null,
      licence_count:  licCountMap.get(a.worker_user_id) ?? 0,
      requested_at:   a.requested_at,
    };
  });

  return json(200, { pending });
});
