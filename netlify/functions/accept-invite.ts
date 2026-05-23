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
import { signSessionToken, hasSecretSalt } from './_shared/token.js';
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
  expires_at: string;
  accepted_at: string | null;
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
    return jsonResponse(400, { valid: false, error: 'bad-pin' });
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { valid: false, error: (e as Error).message });
  }

  const { data: invite } = await sb
    .from('user_invites')
    .select('id, tenant_id, email, role, entitlements, expires_at, accepted_at')
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
  const pinHash = await bcrypt.hash(pin, 10);
  const { data: created, error: insertErr } = await sb
    .from('users')
    .insert({
      email: invite.email,
      tenant_id: invite.tenant_id,
      role: invite.role,
      is_platform_admin: false, // Invited users are never platform admins by default.
      active: true,
      pin_hash: pinHash,
    })
    .select('id, email, tenant_id, role, is_platform_admin, active, last_login_at')
    .single<Omit<CanonicalUser, 'pin_hash'>>();

  if (insertErr || !created) {
    // eslint-disable-next-line no-console
    console.error('[accept-invite] user insert failed:', insertErr?.message);
    return jsonResponse(500, { valid: false, error: 'server-error' });
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

  // Mark the invite accepted.
  await sb
    .from('user_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  const inviteIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                 ?? req.headers.get('client-ip')
                 ?? 'unknown';
  void sb.rpc('eq_write_audit_log', { p_event: 'invite.accepted', p_actor_id: created.id, p_tenant_id: invite.tenant_id, p_ip: inviteIp, p_detail: { role: created.role } });

  // Hydrate tenant for the response.
  const { data: tenant } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, active')
    .eq('id', invite.tenant_id)
    .maybeSingle<CanonicalTenant>();

  if (!tenant || !tenant.active) {
    // Pathological: tenant disappeared between invite + accept. The
    // user is created but they have nowhere to go. Surface as 500;
    // ops cleans up.
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
    role: created.role,
    is_platform_admin: created.is_platform_admin,
    exp,
  });
  // Domain scoping handled by buildSessionCookie — same rule as
  // shell-login: .eq.solutions on prod hosts, host-only off-domain.
  const cookie = buildSessionCookie(req, cookieValue, {
    maxAgeSeconds: SESSION_TTL_MS / 1000,
  });

  const supabaseJwt = signSupabaseJwt(
    created.id,
    tenant.id,
    created.role,
    created.is_platform_admin,
  );

  return jsonResponse(
    200,
    {
      valid: true,
      user: created,
      tenant,
      entitlements: entitlements ?? [],
      supabase_jwt: supabaseJwt,
    },
    { 'Set-Cookie': cookie },
  );
});
