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
