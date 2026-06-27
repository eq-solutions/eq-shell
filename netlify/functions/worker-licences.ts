// GET /.netlify/functions/worker-licences?worker_user_id=<uuid>
//
// Returns public.licences for a given worker, used by the licence review
// modal before approving a Cards connection. Gated to admin.review_cards.

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

  const url = new URL(req.url);
  const workerUserId = url.searchParams.get('worker_user_id');
  if (!workerUserId) return json(400, { error: 'worker_user_id is required' });

  const sb = getServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbPublic = (sb as any).schema('public');

  // Tenant scope: a manager may only read licences for a worker who has a
  // PENDING, worker-initiated connection request to THIS manager's org. Without
  // this check, admin.review_cards would let any manager pull any worker's
  // licence photos + numbers (sensitive PII) cross-tenant by guessing user_ids.
  // Mirrors the scoping in staff-pending-connections.ts.
  const { data: org } = (await sbPublic
    .from('organisations')
    .select('id')
    .eq('tenant_id', session.tenant_id)
    .maybeSingle()) as { data: { id: string } | null };

  if (!org) return json(403, { error: 'No organisation for this tenant' });

  const { data: request } = (await sbPublic
    .from('org_access_requests')
    .select('id, requested_by, worker_user_id')
    .eq('org_id', org.id)
    .eq('worker_user_id', workerUserId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()) as { data: { id: string; requested_by: string; worker_user_id: string } | null };

  // Must exist AND be worker-initiated (requested_by === the worker themselves),
  // matching the trust boundary staff-pending-connections.ts enforces.
  if (!request || request.requested_by !== request.worker_user_id) {
    return json(403, { error: 'No pending connection request from this worker to your organisation' });
  }

  const { data, error } = (await sbPublic
    .from('licences')
    .select('id, licence_type, licence_number, issue_date, expiry_date, never_expires, issuing_authority, state, photo_front_url, photo_back_url, notes')
    .eq('user_id', workerUserId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })) as {
    data: Array<{
      id: string;
      licence_type: string;
      licence_number: string | null;
      issue_date: string | null;
      expiry_date: string | null;
      never_expires: boolean | null;
      issuing_authority: string | null;
      state: string | null;
      photo_front_url: string | null;
      photo_back_url: string | null;
      notes: string | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) return json(500, { error: error.message });

  return json(200, { licences: data ?? [] });
});
