// POST /.netlify/functions/invite-user
//
// Phase 1.F — admin invite flow.
//
// Requires:
//   - Valid eq_shell_session cookie
//   - Calling user has perms equivalent to useCan('admin.invite_user')
//     (manager OR platform_admin — same logic enforced server-side too,
//     never trust client-side gates alone)
//
// Body: { email: string, role: EqRole, entitlements?: string[] }
//
// Effect:
//   1. Generates a one-time invite token. Stores its bcrypt hash on
//      a new user_invites row scoped to the caller's tenant_id.
//   2. Sends an email with a magic link the recipient clicks to set
//      their PIN. (Email is log-only until EQ_EMAIL_PROVIDER is
//      configured — invite_url is returned in the response body so
//      Royce can paste it manually in the interim.)
//
// Response:
//   200 OK { ok: true, invite_id, invite_url, email_delivered }
//   400    { ok: false, error: 'bad-request' }
//   401    { ok: false, error: 'unauthorized' } — no valid session
//   403    { ok: false, error: 'forbidden' }    — lacks admin.invite_user
//   409    { ok: false, error: 'already-invited' | 'user-exists' }
//   500    { ok: false, error: 'server-error' }
//
// Spec: IDENTITY-MODEL.md §5 + PHASE-1F-PLAN.md §6.

import { createHash, randomBytes } from 'node:crypto';
import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, EqRole } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { sendEmail } from './_shared/email.js';
import { withSentry } from './_shared/sentry.js';

const VALID_ROLES: ReadonlySet<EqRole> = new Set([
  'manager',
  'supervisor',
  'employee',
  'apprentice',
  'labour_hire',
]);

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function inviteUrlFor(req: Request, token: string): string {
  // Build the URL from the request's Host header so this works on
  // production (core.eq.solutions) AND on deploy-previews
  // (deploy-preview-N--eq-shell.netlify.app).
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/accept-invite?token=${encodeURIComponent(token)}`;
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { ok: false, error: 'server-misconfigured' });
  }

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  // Server-side permission check — must mirror the in-shell useCan()
  // matrix entry for admin.invite_user. The matrix grants this to
  // manager + (via platform_admin short-circuit) platform admins.
  const isManager = session.role === 'manager';
  const allowed = isManager || session.is_platform_admin === true;
  if (!allowed) {
    return jsonResponse(403, { ok: false, error: 'forbidden' });
  }

  let body: { email?: string; role?: string; entitlements?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const role = (body.role ?? '').trim();
  const entitlements = Array.isArray(body.entitlements)
    ? body.entitlements.filter((v): v is string => typeof v === 'string')
    : [];

  if (!email || !email.includes('@')) {
    return jsonResponse(400, { ok: false, error: 'bad-email' });
  }
  if (!VALID_ROLES.has(role as EqRole)) {
    return jsonResponse(400, { ok: false, error: 'bad-role' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  const { data: existingUser } = await sb
    .from('users')
    .select('id, name, email')
    .eq('email', email)
    .maybeSingle<Pick<CanonicalUser, 'id' | 'name' | 'email'>>();

  if (existingUser) {
    const { data: existingMembership } = await sb
      .schema('shell_control')
      .from('user_tenant_memberships')
      .select('user_id, tenant_id')
      .eq('user_id', existingUser.id)
      .eq('tenant_id', session.tenant_id)
      .maybeSingle<{ user_id: string; tenant_id: string }>();

    if (existingMembership) {
      return jsonResponse(409, { ok: false, error: 'already-a-member' });
    }

    const { error: memErr } = await sb
      .schema('shell_control')
      .from('user_tenant_memberships')
      .insert({
        user_id: existingUser.id,
        tenant_id: session.tenant_id,
        role: role as EqRole,
        active: true,
      });

    if (memErr) {
      // eslint-disable-next-line no-console
      console.error('[invite-user] membership insert failed:', memErr.message);
      return jsonResponse(500, { ok: false, error: 'server-error' });
    }

    if (entitlements.length > 0) {
      const rows = entitlements.map((mod) => ({
        tenant_id: session.tenant_id,
        module: mod,
        enabled: true,
      }));
      void sb
        .from('module_entitlements')
        .upsert(rows, { onConflict: 'tenant_id,module', ignoreDuplicates: true });
    }

    const { data: tenantRow } = await sb
      .from('tenants')
      .select('name')
      .eq('id', session.tenant_id)
      .maybeSingle<{ name: string }>();
    const tenantName = tenantRow?.name ?? 'an EQ Solutions workspace';

    const addedEmailResult = await sendEmail({
      to: email,
      subject: `You've been added to ${tenantName} on EQ Solutions`,
      text:
`You've been added to ${tenantName} on EQ Solutions.

Next time you sign in to your EQ Solutions account, you'll be able to choose ${tenantName} as your workspace.

If you weren't expecting this, you can ignore this email.

— EQ Solutions`,
    });

    return jsonResponse(200, {
      ok: true,
      added_to_tenant: true,
      user_id: existingUser.id,
      email_delivered: addedEmailResult.delivered,
    });
  }

  // Reject if an active (non-accepted, non-expired) invite already
  // exists for this email in this tenant. Re-inviting requires the
  // old invite to expire or be explicitly revoked (separate endpoint).
  const { data: existingInvite } = await sb
    .from('user_invites')
    .select('id, expires_at, accepted_at')
    .eq('tenant_id', session.tenant_id)
    .eq('email', email)
    .is('accepted_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle<{ id: string; expires_at: string; accepted_at: string | null }>();
  if (existingInvite) {
    return jsonResponse(409, { ok: false, error: 'already-invited' });
  }

  // Mint the one-time invite token. 32 random bytes hex-encoded
  // (256-bit entropy → brute-force is 2^256 ops, infeasible). We
  // store the SHA-256 hash for deterministic lookup; bcrypt would be
  // wrong here because (a) the input is already high-entropy so
  // bcrypt's slow factor adds nothing, and (b) bcrypt isn't
  // deterministic so we can't index by hash — accept-invite would
  // have to iterate every unaccepted row.
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { data: inserted, error: insertErr } = await sb
    .from('user_invites')
    .insert({
      tenant_id: session.tenant_id,
      email,
      role: role as EqRole,
      entitlements,
      invited_by: session.user_id,
      invite_token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select('id')
    .single<{ id: string }>();

  if (insertErr || !inserted) {
    // eslint-disable-next-line no-console
    console.error('[invite-user] insert failed:', insertErr?.message);
    return jsonResponse(500, { ok: false, error: 'server-error' });
  }

  const inviteUrl = inviteUrlFor(req, rawToken);

  const emailResult = await sendEmail({
    to: email,
    subject: `You've been invited to EQ Solutions`,
    text:
`You've been invited to join an EQ Solutions tenant.

Click the link below to set your PIN and get started:

${inviteUrl}

This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this email, you can ignore it.

— EQ Solutions`,
  });

  return jsonResponse(200, {
    ok: true,
    invite_id: inserted.id,
    invite_url: inviteUrl,
    email_delivered: emailResult.delivered,
  });
});
