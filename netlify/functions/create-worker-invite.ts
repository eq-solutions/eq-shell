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
import { createHash, randomBytes } from 'node:crypto';
import { getServiceClient } from './_shared/supabase.js';
import type { EqRole } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { normalizeAuPhone } from './_shared/phone.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';
import { sendEmail } from './_shared/email.js';

const VALID_ROLES = new Set(['manager', 'supervisor', 'employee', 'apprentice', 'labour_hire']);
const INVITE_TTL_DAYS = 30;

function shellInviteUrl(req: Request, token: string): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/accept-invite?token=${encodeURIComponent(token)}`;
}

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
    .select('id, name')
    .eq('tenant_id', session.tenant_id)
    .maybeSingle<{ id: string; name: string }>();

  if (orgErr) return json(500, { error: 'DB error resolving org: ' + orgErr.message });
  if (!org)   return json(400, { error: 'No organisation found for this tenant. Contact support.' });

  const orgName = org.name || 'Your employer';

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
      const claimUrl = `https://cards.eq.solutions/claim/${existingInvite.token}`;
      let emailDelivered = false;
      if (email) {
        const result = await sendEmail({
          to: email,
          subject: `You've been invited to join ${orgName}`,
          text: `Hi ${firstName},\n\n${orgName} has invited you to join their team on EQ.\n\nClick the link below to set up your profile:\n${claimUrl}\n\nThis link expires on ${new Date(existingInvite.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.\n\nIf you didn't expect this invite, you can ignore it.`,
        });
        emailDelivered = result.delivered;
      }
      return json(200, {
        ok: true,
        claim_url: claimUrl,
        token: existingInvite.token,
        worker_id: existingWorker.id,
        expires_at: existingInvite.expires_at,
        reused: true,
        email_delivered: emailDelivered,
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
      profile_data:  { first_name: firstName, last_name: lastName, phone, email, role },
      licences_data: [],
      created_by:    session.user_id,
      expires_at:    expiresAt,
    })
    .select('token, expires_at')
    .single<{ token: string; expires_at: string }>();

  if (inviteErr || !invite) {
    return json(500, { error: 'Failed to create invite: ' + (inviteErr?.message ?? 'unknown') });
  }

  const claimUrl = `https://cards.eq.solutions/claim/${invite.token}`;

  // Create a Shell (Core) user_invite when email is provided, linked to the worker record
  // via worker_id. When the worker accepts this invite, accept-invite.ts writes
  // workers.user_id = created shell user id — from that point, mint-iframe-token can emit
  // canonical_user_id = worker.id in the Field JWT, completing the identity chain.
  let coreInviteUrl: string | null = null;
  if (email) {
    const shellToken = randomBytes(32).toString('hex');
    const shellTokenHash = createHash('sha256').update(shellToken).digest('hex');
    // Entitlements scoped by role: managers/supervisors get broader app access.
    const inviteEntitlements =
      (role === 'manager' || role === 'supervisor')
        ? ['field', 'service', 'quotes']
        : ['field'];

    const { error: shellErr } = await sb
      .from('user_invites')
      .insert({
        tenant_id:         session.tenant_id,
        email,
        role:              role as EqRole,
        entitlements:      inviteEntitlements,
        phone,
        invited_by:        session.user_id,
        invite_token_hash: shellTokenHash,
        expires_at:        expiresAt,
        worker_id:         workerId,
      });
    if (!shellErr) {
      coreInviteUrl = shellInviteUrl(req, shellToken);
    } else {
      console.warn('[create-worker-invite] shell user_invite insert failed (non-fatal):', shellErr.message);
    }
  }

  let emailDelivered = false;
  if (email) {
    const expiryDate = new Date(invite.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    const text = coreInviteUrl
      ? `Hi ${firstName},\n\n${orgName} has invited you to join their team on EQ.\n\nStep 1 — Set up your profile in EQ Cards:\n${claimUrl}\n\nStep 2 — Create your EQ Core login to access Field and other apps:\n${coreInviteUrl}\n\nBoth links expire on ${expiryDate}.\n\nIf you didn't expect this invite, you can ignore it.`
      : `Hi ${firstName},\n\n${orgName} has invited you to join their team on EQ.\n\nClick the link below to set up your profile:\n${claimUrl}\n\nThis link expires on ${expiryDate}.\n\nIf you didn't expect this invite, you can ignore it.`;
    const result = await sendEmail({
      to: email,
      subject: `You've been invited to join ${orgName} on EQ`,
      text,
    });
    emailDelivered = result.delivered;
  }

  return json(201, {
    ok: true,
    claim_url:      claimUrl,
    core_invite_url: coreInviteUrl,
    token:          invite.token,
    worker_id:      workerId,
    expires_at:     invite.expires_at,
    reused:         false,
    email_delivered: emailDelivered,
  });
});
