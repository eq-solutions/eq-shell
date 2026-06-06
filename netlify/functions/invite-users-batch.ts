// POST /.netlify/functions/invite-users-batch
//
// Bulk sibling of invite-user.ts — onboard many people in one call
// (e.g. a whole company's staff list). Each row is processed with the
// SAME logic as invite-user: existing user → add tenant membership;
// open invite already present → skip; otherwise mint a one-time token
// and (try to) email it. This function does NOT re-implement the
// invite rules — it mirrors invite-user.ts row-for-row so the two
// paths can never drift.
//
// Requires:
//   - Valid eq_shell_session cookie
//   - Calling user has admin.invite_user (manager OR platform_admin),
//     enforced server-side — same gate as the single-invite endpoint.
//
// Body: { invites: { email: string, role: EqRole, entitlements?: string[] }[] }
//
// Response:
//   200 OK {
//     ok: true,
//     results: {
//       email: string,
//       status: 'invited' | 'added-to-tenant' | 'already-member'
//             | 'already-invited' | 'failed',
//       invite_url?: string,   // present when status === 'invited'
//       email_delivered?: boolean,
//       error?: string,        // present when status === 'failed'
//     }[]
//   }
//   400 { ok: false, error: 'bad-request' | 'empty' | 'too-many' }
//   401 { ok: false, error: 'unauthorized' }
//   403 { ok: false, error: 'forbidden' }
//   500 { ok: false, error: 'server-error' | 'server-misconfigured' }
//
// Cap: 50 rows per call. A company rollout chunks the staff list into
// batches of 50 — keeps each invocation comfortably inside the Netlify
// function timeout even when the email provider is live (each row may
// make an outbound Resend call).
//
// Spec: docs/runbooks/sks-onboarding.md §"Send invites in bulk".

import { createHash, randomBytes } from 'node:crypto';
import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, EqRole } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { sendEmail } from './_shared/email.js';
import { normalizeAuPhone } from './_shared/phone.js';
import { can } from './_shared/permissions.js';
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
const MAX_ROWS = 50;

type RowStatus = 'invited' | 'added-to-tenant' | 'already-member' | 'already-invited' | 'failed';

interface RowResult {
  email: string;
  status: RowStatus;
  invite_url?: string;
  email_delivered?: boolean;
  error?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function inviteUrlFor(req: Request, token: string): string {
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
  if (!can(session, 'admin.invite_user')) {
    return jsonResponse(403, { ok: false, error: 'forbidden' });
  }

  let body: { invites?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  if (!Array.isArray(body.invites)) {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }
  if (body.invites.length === 0) {
    return jsonResponse(400, { ok: false, error: 'empty' });
  }
  if (body.invites.length > MAX_ROWS) {
    return jsonResponse(400, { ok: false, error: 'too-many' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  // Tenant name fetched once — used in the "added to an existing tenant"
  // email. Cheap to do up front rather than per row.
  const { data: tenantRow } = await sb
    .from('tenants')
    .select('name')
    .eq('id', session.tenant_id)
    .maybeSingle<{ name: string }>();
  const tenantName = tenantRow?.name ?? 'an EQ Solutions workspace';

  const results: RowResult[] = [];
  const seen = new Set<string>();

  for (const raw of body.invites) {
    const row = (raw ?? {}) as { email?: string; role?: string; entitlements?: unknown; phone?: string };
    const email = (row.email ?? '').trim().toLowerCase();
    const role = (row.role ?? '').trim();
    const entitlements = Array.isArray(row.entitlements)
      ? row.entitlements.filter((v): v is string => typeof v === 'string')
      : [];
    const rawPhone = (row.phone ?? '').trim();
    const phone = rawPhone ? normalizeAuPhone(rawPhone) : null;

    if (!email || !email.includes('@')) {
      results.push({ email: email || '(blank)', status: 'failed', error: 'bad-email' });
      continue;
    }
    if (!VALID_ROLES.has(role as EqRole)) {
      results.push({ email, status: 'failed', error: 'bad-role' });
      continue;
    }
    if (rawPhone && !phone) {
      results.push({ email, status: 'failed', error: 'bad-phone' });
      continue;
    }
    if (seen.has(email)) {
      results.push({ email, status: 'failed', error: 'duplicate-in-batch' });
      continue;
    }
    seen.add(email);

    try {
      const result = await processOne(sb, req, session.tenant_id, session.user_id, tenantName, email, role as EqRole, entitlements, phone);
      results.push(result);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[invite-users-batch] row failed:', email, (e as Error).message);
      results.push({ email, status: 'failed', error: 'server-error' });
    }
  }

  return jsonResponse(200, { ok: true, results });
});

// One row, identical in behaviour to invite-user.ts. Kept as a local
// helper (not a shared import) deliberately: invite-user.ts is the auth
// surface of record and we don't want a refactor of it riding along
// with this additive feature. If these ever need to share, extract
// both at once with downstream verification.
async function processOne(
  sb: ReturnType<typeof getServiceClient>,
  req: Request,
  tenantId: string,
  invitedBy: string,
  tenantName: string,
  email: string,
  role: EqRole,
  entitlements: string[],
  phone: string | null,
): Promise<RowResult> {
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
      .eq('tenant_id', tenantId)
      .maybeSingle<{ user_id: string; tenant_id: string }>();

    if (existingMembership) {
      return { email, status: 'already-member' };
    }

    const { error: memErr } = await sb
      .schema('shell_control')
      .from('user_tenant_memberships')
      .insert({ user_id: existingUser.id, tenant_id: tenantId, role, active: true });

    if (memErr) {
      return { email, status: 'failed', error: 'server-error' };
    }

    if (entitlements.length > 0) {
      const rows = entitlements.map((mod) => ({ tenant_id: tenantId, module: mod, enabled: true }));
      void sb
        .from('module_entitlements')
        .upsert(rows, { onConflict: 'tenant_id,module', ignoreDuplicates: true });
    }

    const addedEmailResult = await sendEmail({
      to: email,
      subject: `You've been added to ${tenantName} on EQ Solutions`,
      text:
`You've been added to ${tenantName} on EQ Solutions.

Next time you sign in to your EQ Solutions account, you'll be able to choose ${tenantName} as your workspace.

If you weren't expecting this, you can ignore this email.

— EQ Solutions`,
    });

    return { email, status: 'added-to-tenant', email_delivered: addedEmailResult.delivered };
  }

  // Open (unaccepted, unexpired) invite already present → skip.
  const { data: existingInvite } = await sb
    .from('user_invites')
    .select('id, expires_at, accepted_at')
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .is('accepted_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle<{ id: string; expires_at: string; accepted_at: string | null }>();
  if (existingInvite) {
    return { email, status: 'already-invited' };
  }

  // Mint the one-time invite token — 256-bit entropy, SHA-256 hash
  // stored for deterministic lookup (same scheme as invite-user.ts).
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { data: inserted, error: insertErr } = await sb
    .from('user_invites')
    .insert({
      tenant_id: tenantId,
      email,
      role,
      entitlements,
      phone,
      invited_by: invitedBy,
      invite_token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select('id')
    .single<{ id: string }>();

  if (insertErr || !inserted) {
    return { email, status: 'failed', error: 'server-error' };
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

  return { email, status: 'invited', invite_url: inviteUrl, email_delivered: emailResult.delivered };
}
