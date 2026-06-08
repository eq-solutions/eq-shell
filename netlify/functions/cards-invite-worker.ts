// POST /.netlify/functions/cards-invite-worker
//
// Body: { phone: string }  — E.164 format
//
// Creates a pending org_membership for a worker invited by phone.
// Optionally links an existing worker record if the phone matches.
// No SMS is sent — the invite is a pending row the worker sees on next login.
//
// Manager + platform_admin only.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

interface InviteBody {
  phone: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });

  if (!can(session, 'admin.review_cards')) {
    return json(403, { error: 'Manager access required' });
  }

  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { phone } = body;
  if (!phone || !E164_RE.test(phone.trim())) {
    return json(400, { error: 'A valid E.164 phone number is required (e.g. +61412345678)' });
  }
  const normPhone = phone.trim();

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // Find the organisation for this tenant on the canonical plane.
  const { data: org, error: orgErr } = await sb
    .from('organisations')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orgErr) return json(500, { error: orgErr.message });
  if (!org) return json(400, { error: 'No organisation found for this tenant' });

  // Guard against duplicate invites for the same phone + org.
  const { data: existing } = await sb
    .from('org_memberships')
    .select('id, status')
    .eq('org_id', org.id)
    .eq('invited_phone', normPhone)
    .maybeSingle();

  if (existing) {
    return json(409, {
      error: `A membership for this number already exists (${existing.status})`,
    });
  }

  // Try to resolve an existing worker by phone — nullable, not required.
  const { data: worker } = await sb
    .from('workers')
    .select('id, user_id')
    .eq('phone', normPhone)
    .maybeSingle();

  // Insert the pending membership.
  const { data: membership, error: insertErr } = await sb
    .from('org_memberships')
    .insert({
      org_id: org.id,
      tenant_id: tenantId,
      status: 'pending',
      invited_phone: normPhone,
      invited_by: session.user_id,
      user_id: worker?.user_id ?? null,
    })
    .select()
    .single();

  if (insertErr) return json(500, { error: insertErr.message });

  return json(201, { membership, worker_found: !!worker });
});
