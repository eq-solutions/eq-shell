// POST /.netlify/functions/create-worker-invite
//
// Creates a worker record in eq-canonical (or finds an existing one by phone)
// then generates a worker_invite token. Returns the Cards claim URL that the
// admin can send to the worker via SMS, WhatsApp, or email.
//
// Body: { first_name, last_name, phone, role?, email? }
//   phone   — AU mobile in any common format (0412…, +61412…); stored as E.164
//   role    — optional; defaults to 'employee'
//   email   — optional; used for Shell invite later if worker wants desktop access
//
// If an unclaimed, non-expired invite already exists for this phone + org,
// the existing claim_url is returned (reused: true) rather than creating a
// duplicate. This makes the endpoint safe to call multiple times.
//
// Manager + platform_admin only.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { normalizeAuPhone } from './_shared/phone.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const VALID_ROLES = new Set(['manager', 'supervisor', 'employee', 'apprentice', 'labour_hire']);
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

  let body: { first_name?: string; last_name?: string; phone?: string; role?: string; email?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const firstName = (body.first_name ?? '').trim();
  const lastName  = (body.last_name  ?? '').trim();
  const rawPhone  = (body.phone      ?? '').trim();
  const rawEmail  = (body.email      ?? '').trim().toLowerCase();
  const role      = (body.role       ?? 'employee').trim();

  if (!firstName)                return json(400, { error: 'first_name is required' });
  if (!rawPhone)                 return json(400, { error: 'phone is required' });
  if (!VALID_ROLES.has(role))   return json(400, { error: 'Invalid role' });
  if (rawEmail && !rawEmail.includes('@')) return json(400, { error: 'Invalid email address' });

  const phone = normalizeAuPhone(rawPhone);
  if (!phone) return json(400, { error: 'phone must be a valid Australian mobile (e.g. 0412 345 678)' });

  const email = rawEmail || null;

  let sb;
  try { sb = getServiceClient(); } catch (e) {
    return json(500, { error: (e as Error).message });
  }

  // Resolve the canonical org for this tenant. eq-canonical organisations are in
  // the public schema; the service client defaults to shell_control so we use
  // .schema('public') explicitly for every public-schema table in this file.
  const { data: org, error: orgErr } = await sb
    .schema('public')
    .from('organisations')
    .select('id')
    .eq('tenant_id', session.tenant_id)
    .maybeSingle<{ id: string }>();

  if (orgErr) return json(500, { error: 'DB error resolving org: ' + orgErr.message });
  if (!org)   return json(400, { error: 'No organisation found for this tenant. Contact support.' });

  // Find existing worker by phone (workers are global — a tradie can belong to
  // multiple orgs, so we match on phone across the whole workers table).
  const { data: existingWorker } = await sb
    .schema('public')
    .from('workers')
    .select('id, user_id')
    .eq('phone', phone)
    .maybeSingle<{ id: string; user_id: string | null }>();

  // If worker already exists, check whether an active unclaimed invite already
  // exists for this org. If so, return it rather than creating a duplicate.
  if (existingWorker) {
    const { data: existingInvite } = await sb
      .schema('public')
      .from('worker_invites')
      .select('token, expires_at')
      .eq('org_id', org.id)
      .eq('worker_id', existingWorker.id)
      .is('claimed_at', null)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ token: string; expires_at: string }>();

    if (existingInvite) {
      return json(200, {
        ok: true,
        claim_url: `https://cards.eq.solutions/claim/${existingInvite.token}`,
        token: existingInvite.token,
        worker_id: existingWorker.id,
        expires_at: existingInvite.expires_at,
        reused: true,
      });
    }
  }

  // Create or use existing worker record.
  let workerId: string;

  if (existingWorker) {
    workerId = existingWorker.id;
    // Soft-update name only if worker has never claimed (user_id null).
    // Claimed workers own their own data — don't overwrite.
    if (!existingWorker.user_id) {
      await sb.schema('public').from('workers').update({
        first_name: firstName,
        last_name:  lastName,
        ...(email ? { email } : {}),
      }).eq('id', workerId);
    }
  } else {
    const { data: newWorker, error: workerErr } = await sb
      .schema('public')
      .from('workers')
      .insert({ first_name: firstName, last_name: lastName, phone, email })
      .select('id')
      .single<{ id: string }>();

    if (workerErr || !newWorker) {
      return json(500, { error: 'Failed to create worker: ' + (workerErr?.message ?? 'unknown') });
    }
    workerId = newWorker.id;
  }

  // Create the invite. Expires in 30 days (vs the legacy 14-day default).
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error: inviteErr } = await sb
    .schema('public')
    .from('worker_invites')
    .insert({
      org_id:        org.id,
      worker_id:     workerId,
      profile_data:  { first_name: firstName, last_name: lastName, phone, email },
      licences_data: [],
      created_by:    session.user_id,
      expires_at:    expiresAt,
    })
    .select('token, expires_at')
    .single<{ token: string; expires_at: string }>();

  if (inviteErr || !invite) {
    return json(500, { error: 'Failed to create invite: ' + (inviteErr?.message ?? 'unknown') });
  }

  return json(201, {
    ok: true,
    claim_url:  `https://cards.eq.solutions/claim/${invite.token}`,
    token:      invite.token,
    worker_id:  workerId,
    expires_at: invite.expires_at,
    reused:     false,
  });
});
