// POST /.netlify/functions/resend-worker-invite
//
// Creates a fresh 30-day invite for an existing worker. The old invite is NOT
// deleted — it stays in the DB for audit. The new invite supersedes it.
//
// Use this when a pending invite has expired or the worker lost the link.
// Also valid for workers who have a Shell account but haven't completed Cards
// onboarding — the Shell account (user_id) and the Cards wallet (claimed_at)
// are separate flows.
//
// Body: { worker_id: string }
//
// Rejects if:
//   - The worker doesn't exist
//   - The worker has no prior invite for this org
//
// Manager + platform_admin only.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';
import { sendEmail } from './_shared/email.js';

const INVITE_TTL_DAYS = 30;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });
  if (!can(session, 'admin.invite_user')) return json(403, { error: 'Manager access required' });

  let body: { worker_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const workerId = (body.worker_id ?? '').trim();
  if (!workerId) return json(400, { error: 'worker_id is required' });

  let sb;
  try { sb = getServiceClient(); } catch (e) {
    return json(500, { error: (e as Error).message });
  }

  // Resolve org
  const { data: org, error: orgErr } = await sb
    .schema('public')
    .from('organisations')
    .select('id')
    .eq('tenant_id', session.tenant_id)
    .maybeSingle<{ id: string }>();

  if (orgErr) return json(500, { error: 'DB error: ' + orgErr.message });
  if (!org)   return json(400, { error: 'No organisation found for this tenant.' });

  // Verify worker exists and is linked to this org via an invite
  const { data: worker, error: workerErr } = await sb
    .schema('public')
    .from('workers')
    .select('id, user_id, first_name, last_name, phone, email')
    .eq('id', workerId)
    .maybeSingle<{ id: string; user_id: string | null; first_name: string | null; last_name: string | null; phone: string | null; email: string | null }>();

  if (workerErr) return json(500, { error: 'DB error: ' + workerErr.message });
  if (!worker)   return json(404, { error: 'Worker not found.' });

  // Confirm the worker has a prior invite for this org (i.e. they belong here)
  const { data: priorInvite } = await sb
    .schema('public')
    .from('worker_invites')
    .select('id')
    .eq('org_id', org.id)
    .eq('worker_id', workerId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!priorInvite) {
    return json(404, { error: 'Worker has no prior invite for this organisation.' });
  }

  // Create a new invite
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: newInvite, error: inviteErr } = await sb
    .schema('public')
    .from('worker_invites')
    .insert({
      org_id:       org.id,
      worker_id:    workerId,
      profile_data: {
        first_name: worker.first_name,
        last_name:  worker.last_name,
        phone:      worker.phone,
        email:      worker.email,
      },
      licences_data: [],
      created_by:    session.user_id,
      expires_at:    expiresAt,
    })
    .select('token, expires_at')
    .single<{ token: string; expires_at: string }>();

  if (inviteErr || !newInvite) {
    return json(500, { error: 'Failed to create new invite: ' + (inviteErr?.message ?? 'unknown') });
  }

  const claimUrl = `https://cards.eq.solutions/claim?token=${newInvite.token}`;

  // Send email if the worker has one on record.
  let emailDelivered = false;
  if (worker.email) {
    const expiryDate = new Date(newInvite.expires_at).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const result = await sendEmail({
      to: worker.email,
      subject: 'Your EQ Cards activation link',
      text: `Hi ${worker.first_name ?? 'there'},\n\nHere's your updated EQ Cards activation link:\n\n${claimUrl}\n\nThis link expires on ${expiryDate}.\n\nIf you didn't expect this, you can ignore it.`,
    });
    emailDelivered = result.delivered;
  }

  return json(201, {
    ok: true,
    claim_url:      claimUrl,
    token:          newInvite.token,
    worker_id:      workerId,
    expires_at:     newInvite.expires_at,
    email_delivered: emailDelivered,
  });
});
