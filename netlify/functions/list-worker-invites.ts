// GET /.netlify/functions/list-worker-invites
//
// Returns all worker_invites for the current tenant's organisation, enriched
// with worker name + phone and computed status.
//
// Status logic (computed server-side, not stored):
//   claimed  — claimed_at IS NOT NULL
//   expired  — claimed_at IS NULL AND expires_at < now()
//   pending  — claimed_at IS NULL AND expires_at >= now()
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

type InviteStatus = 'claimed' | 'active' | 'expired' | 'pending';

interface InviteRow {
  id: string;
  token: string;
  worker_id: string | null;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  is_activated: boolean;
  status: InviteStatus;
  claim_url: string;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });
  if (!can(session, 'admin.invite_user')) return json(403, { error: 'Manager access required' });

  let sb;
  try { sb = getServiceClient(); } catch (e) {
    return json(500, { error: (e as Error).message });
  }

  // Resolve org for this tenant
  const { data: org, error: orgErr } = await sb
    .schema('public')
    .from('organisations')
    .select('id')
    .eq('tenant_id', session.tenant_id)
    .maybeSingle<{ id: string }>();

  if (orgErr) return json(500, { error: 'DB error: ' + orgErr.message });
  if (!org)   return json(200, { invites: [] }); // no org yet — empty list, not an error

  // Fetch invites with joined worker data
  const { data: rows, error: listErr } = await sb
    .schema('public')
    .from('worker_invites')
    .select(`
      id,
      token,
      worker_id,
      created_at,
      expires_at,
      claimed_at,
      workers (
        first_name,
        last_name,
        phone,
        email,
        user_id
      )
    `)
    .eq('org_id', org.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (listErr) return json(500, { error: 'DB error listing invites: ' + listErr.message });

  const now = new Date();

  const invites: InviteRow[] = (rows ?? []).map((r: any) => {
    const w = r.workers as {
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
      user_id: string | null;
    } | null;

    const isActivated = !!(w?.user_id);

    let status: InviteStatus;
    if (r.claimed_at) {
      status = 'claimed';
    } else if (isActivated) {
      // Shell account exists but Cards wallet not yet completed — distinct from pending.
      status = 'active';
    } else if (new Date(r.expires_at) < now) {
      status = 'expired';
    } else {
      status = 'pending';
    }

    return {
      id:           r.id,
      token:        r.token,
      worker_id:    r.worker_id,
      created_at:   r.created_at,
      expires_at:   r.expires_at,
      claimed_at:   r.claimed_at,
      first_name:   w?.first_name ?? null,
      last_name:    w?.last_name  ?? null,
      phone:        w?.phone      ?? null,
      email:        w?.email      ?? null,
      is_activated: isActivated,
      status,
      claim_url:    (status === 'pending' || status === 'active')
        ? `https://cards.eq.solutions/claim?token=${r.token}`
        : '',
    };
  });

  return json(200, { invites });
});
