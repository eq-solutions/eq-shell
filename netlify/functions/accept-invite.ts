// POST /.netlify/functions/accept-invite
//
// Phase 1.F — invite acceptance + first-login.
//
// Public endpoint (no session cookie required) — the invite token IS
// the authentication. The user sets their PIN here and lands signed
// in.
//
// Body: { invite_token: string, pin: string }
//
// Effect:
//   1. SHA-256 the incoming token, look up an unaccepted, unexpired
//      user_invites row by hash. Tenant-scoped via the row's tenant_id.
//   2. Confirm the recipient's email isn't already a users row (race
//      against admin manually creating the same user out-of-band).
//   3. Create the users row with role + tenant_id from the invite +
//      bcrypt-hashed PIN.
//   4. Apply module entitlements: the invite's entitlements list is
//      treated as the set of modules to ENABLE for this tenant. Any
//      not-yet-present module_entitlements rows get inserted enabled.
//      (Existing rows are left alone — they're tenant-scoped, not
//      user-scoped, so we don't want a new user to flip them.)
//   5. Mark the invite accepted_at = now().
//   6. Sign the session cookie + Supabase JWT (mirrors shell-login).
//
// Response:
//   200 OK  { valid: true, user, tenant, entitlements, supabase_jwt }
//             with Set-Cookie: eq_shell_session=...
//   400      { valid: false, error: 'bad-request' | 'bad-pin' }
//   404      { valid: false, error: 'invite-not-found-or-expired' }
//   409      { valid: false, error: 'user-already-exists' }
//   500      { valid: false, error: 'server-error' }
//
// Spec: IDENTITY-MODEL.md §5 + PHASE-1F-PLAN.md §6.

import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, CanonicalTenant, CanonicalEntitlement, EqRole } from './_shared/supabase.js';
import { signSessionToken, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches shell-login

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;

interface InviteRow {
  id: string;
  tenant_id: string;
  email: string;
  role: EqRole;
  entitlements: string[];
  phone: string | null;
  expires_at: string;
  accepted_at: string | null;
  worker_id: string | null;
}

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function isValidPin(pin: string): boolean {
  if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) return false;
  // Allow digits and letters — PIN ≠ numeric-only. Some users will
  // pick a phrase, some a 4-digit number. Both fine.
  return /^[A-Za-z0-9]+$/.test(pin);
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { valid: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { valid: false, error: 'server-misconfigured' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { valid: false, error: 'server-misconfigured' });
  }

  let body: { invite_token?: string; pin?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { valid: false, error: 'bad-request' });
  }

  const rawToken = (body.invite_token ?? '').trim();
  const pin = (body.pin ?? '').trim();

  if (!rawToken) {
    return jsonResponse(400, { valid: false, error: 'bad-request' });
  }
  if (!isValidPin(pin)) {
    return jsonResponse(400, { valid: false, error: 'bad-pin', hint: 'PIN must be 4–12 letters or numbers, no spaces.' });
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[accept-invite] getServiceClient failed:', (e as Error).message);
    return jsonResponse(500, { valid: false, error: 'server-error' });
  }

  const { data: invite } = await sb
    .from('user_invites')
    .select('id, tenant_id, email, role, entitlements, phone, expires_at, accepted_at, worker_id')
    .eq('invite_token_hash', tokenHash)
    .is('accepted_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle<InviteRow>();

  if (!invite) {
    // Note: the error message intentionally doesn't distinguish
    // "token wrong" from "expired" from "already accepted" — any of
    // those means "this invite doesn't work, ask for a new one."
    return jsonResponse(404, { valid: false, error: 'invite-not-found-or-expired' });
  }

  // Race: did someone already create a user with this email out-of-band?
  const { data: existingUser } = await sb
    .from('users')
    .select('id')
    .eq('email', invite.email)
    .maybeSingle<Pick<CanonicalUser, 'id'>>();
  if (existingUser) {
    return jsonResponse(409, { valid: false, error: 'user-already-exists' });
  }

  // Create the user.
  const pinHash = await bcrypt.hash(pin, 12);
  const { data: created, error: insertErr } = await sb
    .from('users')
    .insert({
      email: invite.email,
      tenant_id: invite.tenant_id,
      role: invite.role,
      is_platform_admin: false,
      active: true,
      pin_hash: pinHash,
      phone: invite.phone,
      last_active_tenant_id: invite.tenant_id,
    })
    .select('id, email, tenant_id, role, is_platform_admin, active, last_login_at')
    .single<Omit<CanonicalUser, 'pin_hash' | 'phone' | 'name' | 'last_active_tenant_id'>>();

  if (insertErr || !created) {
    // 23505 = unique_violation. Email collision is already ruled out above,
    // so this is almost certainly the partial-unique index on users.phone —
    // the invited mobile is already linked to another account. Surface it as
    // a clear 409 rather than a generic server error.
    if (insertErr?.code === '23505') {
      return jsonResponse(409, { valid: false, error: 'phone-already-linked' });
    }
    // eslint-disable-next-line no-console
    console.error('[accept-invite] user insert failed:', insertErr?.message);
    return jsonResponse(500, { valid: false, error: 'server-error' });
  }

  // Create a matching auth.users row with the same UUID so the Shell-minted
  // JWT (sub = shell_control user id) passes Supabase's getUser() check when
  // Cards calls setSession(). Without this, the handoff 401s because auth.users
  // has no row for the sub claim — users end up stuck on Cards' own auth screen.
  const { error: authCreateErr } = await sb.auth.admin.createUser({
    id: created.id,
    email: invite.email,
    email_confirm: true,
  });
  if (authCreateErr && authCreateErr.message !== 'User already registered') {
    // Non-fatal — log and continue. The session still works for Shell;
    // Cards iframe will fail gracefully and show a retry prompt.
    console.warn('[accept-invite] auth.users mirror failed:', authCreateErr.message);
  }

  const { error: memErr } = await sb
    .schema('shell_control')
    .from('user_tenant_memberships')
    .insert({
      user_id: created.id,
      tenant_id: invite.tenant_id,
      role: invite.role,
      active: true,
    });
  if (memErr) {
    // eslint-disable-next-line no-console
    console.warn('[accept-invite] membership insert failed (non-fatal):', memErr.message);
  }

  // Apply entitlements — enable any modules the invite specifies that
  // aren't already enabled for the tenant. Module entitlements are
  // tenant-scoped, not user-scoped, so an invite only ADDS modules
  // for the tenant; it never removes existing entitlements.
  if (invite.entitlements.length > 0) {
    const rows = invite.entitlements.map((mod) => ({
      tenant_id: invite.tenant_id,
      module: mod,
      enabled: true,
    }));
    // upsert ignores existing rows; only new (tenant_id, module) pairs land.
    const { error: entErr } = await sb
      .from('module_entitlements')
      .upsert(rows, { onConflict: 'tenant_id,module', ignoreDuplicates: true });
    if (entErr) {
      // eslint-disable-next-line no-console
      console.warn('[accept-invite] entitlement upsert failed (non-fatal):', entErr.message);
    }
  }

  // Link canonical worker to the new shell user so Cards can pre-populate
  // the profile on first open. Best-effort — never blocks the accept flow.
  // Note: workers + worker_invites are in the public schema; the service
  // client defaults to shell_control so we must call .schema('public') here.
  if (invite.worker_id) {
    await sb
      .schema('public')
      .from('workers')
      .update({ user_id: created.id })
      .eq('id', invite.worker_id);

    const { data: workerInvite } = await sb
      .schema('public')
      .from('worker_invites')
      .select('id')
      .eq('worker_id', invite.worker_id)
      .is('claimed_at', null)
      .maybeSingle<{ id: string }>();

    if (workerInvite) {
      await sb
        .schema('public')
        .from('worker_invites')
        .update({ claimed_at: new Date().toISOString(), claimed_by: created.id })
        .eq('id', workerInvite.id);
    }
  }

  const inviteIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                 ?? req.headers.get('client-ip')
                 ?? 'unknown';
  void sb.schema('public').rpc('eq_write_audit_log', { p_event: 'invite.accepted', p_actor_id: created.id, p_tenant_id: invite.tenant_id, p_ip: inviteIp, p_detail: { role: created.role } });

  // Hydrate tenant for the response.
  const { data: tenant } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, active')
    .eq('id', invite.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (!tenant || !tenant.active) {
    // Pathological: tenant disappeared between invite + accept. The
    // user is created but they have nowhere to go. Log the orphaned
    // user_id so ops can recover, then surface as 500.
    // eslint-disable-next-line no-console
    console.error('[accept-invite] tenant missing or inactive after user creation', {
      user_id: created.id,
      tenant_id: invite.tenant_id,
    });
    return jsonResponse(500, { valid: false, error: 'tenant-missing-or-inactive' });
  }

  const { data: entitlements } = await sb
    .from('module_entitlements')
    .select('module, enabled')
    .eq('tenant_id', tenant.id)
    .returns<CanonicalEntitlement[]>();

  // Sign the session cookie — same shape shell-login produces.
  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: created.id,
    tenant_id: tenant.id,
    active_tenant_id: tenant.id,
    role: created.role,
    is_platform_admin: created.is_platform_admin,
    memberships: [{ tenant_id: tenant.id, role: created.role }],
    config: DEFAULT_TENANT_CONFIG,
    exp,
  });
  // Domain scoping handled by buildSessionCookie — same rule as
  // shell-login: .eq.solutions on prod hosts, host-only off-domain.
  const cookie = buildSessionCookie(req, cookieValue, {
    maxAgeSeconds: SESSION_TTL_MS / 1000,
  });

  const { token: supabaseJwt } = signSupabaseJwt(
    created.id,
    tenant.id,
    created.role,
    created.is_platform_admin,
  );

  // Mark the invite accepted — done last so a crash before the cookie is sent
  // leaves the invite still claimable rather than permanently consumed.
  await sb
    .from('user_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return jsonResponse(
    200,
    {
      valid: true,
      user: created,
      tenant,
      entitlements: entitlements ?? [],
      memberships: [{ tenant_id: tenant.id, role: created.role }],
      supabase_jwt: supabaseJwt,
    },
    { 'Set-Cookie': cookie },
  );
});
