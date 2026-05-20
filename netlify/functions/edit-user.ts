// POST /.netlify/functions/edit-user
//
// Phase 1.F — admin user-management mutation.
//
// Requires:
//   - Valid eq_shell_session cookie
//   - Calling user has manager OR platform_admin (server-side mirror
//     of useCan('admin.edit_user') / useCan('admin.deactivate_user'))
//
// Body: {
//   user_id: string,
//   patch: {
//     role?: EqRole,
//     active?: boolean,        // false = deactivate, true = reactivate
//     entitlements?: string[]  // modules to ENABLE for the tenant
//   }
// }
//
// Semantics:
//   - Updates are tenant-scoped: callers can only edit users in their
//     own tenant. Cross-tenant edits are forbidden (manager scope is
//     tenant-bounded; platform_admin gets cross-tenant via a DIFFERENT
//     endpoint when that becomes needed).
//   - `role` change applies on the target user's NEXT login (the
//     change lands in users.role, but their existing session cookie
//     still has the old role until cookie expiry or re-auth).
//   - `active = false` propagates on next request, not next login
//     (verify-shell-session checks active flag on every call).
//   - `entitlements` adds modules to the tenant's module_entitlements;
//     it never removes existing ones (same as accept-invite — module
//     entitlements are tenant-scoped, not user-scoped).
//   - Can't edit yourself (admin must ask another admin to demote
//     them — prevents accidental lockouts).
//   - Can't edit a platform_admin without being one (defence against
//     a tenant manager accidentally locking out support staff).
//
// Response:
//   200 OK  { ok: true, user }
//   400      { ok: false, error: 'bad-request' | 'bad-role' }
//   401      { ok: false, error: 'unauthorized' }
//   403      { ok: false, error: 'forbidden' | 'self-edit-forbidden' | 'cannot-edit-platform-admin' }
//   404      { ok: false, error: 'user-not-found' }
//   500      { ok: false, error: 'server-error' }
//
// Spec: IDENTITY-MODEL.md §5.1 + PHASE-1F-PLAN.md §7.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser, EqRole } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const VALID_ROLES: ReadonlySet<EqRole> = new Set([
  'manager',
  'supervisor',
  'employee',
  'apprentice',
  'labour_hire',
]);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface EditPatch {
  role?: EqRole;
  active?: boolean;
  entitlements?: string[];
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

  const isManager = session.role === 'manager';
  const isAllowed = isManager || session.is_platform_admin === true;
  if (!isAllowed) {
    return jsonResponse(403, { ok: false, error: 'forbidden' });
  }

  let body: { user_id?: string; patch?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  const targetId = (body.user_id ?? '').trim();
  const patch = (body.patch ?? {}) as EditPatch;

  if (!targetId) {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }

  if (targetId === session.user_id) {
    return jsonResponse(403, { ok: false, error: 'self-edit-forbidden' });
  }

  if (patch.role !== undefined && !VALID_ROLES.has(patch.role)) {
    return jsonResponse(400, { ok: false, error: 'bad-role' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  // Load the target user — confirms existence + tenant scope + checks
  // the platform-admin defence.
  const { data: target, error: targetErr } = await sb
    .from('users')
    .select('id, email, tenant_id, role, is_platform_admin, active, last_login_at')
    .eq('id', targetId)
    .maybeSingle<Omit<CanonicalUser, 'pin_hash'>>();

  if (targetErr || !target) {
    return jsonResponse(404, { ok: false, error: 'user-not-found' });
  }

  if (target.tenant_id !== session.tenant_id) {
    // Tenant boundary breach attempt. Surface as 404, not 403, to
    // avoid leaking the existence of cross-tenant user IDs to a
    // probing manager.
    return jsonResponse(404, { ok: false, error: 'user-not-found' });
  }

  if (target.is_platform_admin && !session.is_platform_admin) {
    return jsonResponse(403, { ok: false, error: 'cannot-edit-platform-admin' });
  }

  // Build the actual UPDATE patch. Only the three fields are mutable;
  // everything else (tenant_id, email, is_platform_admin, etc.) is
  // immutable via this endpoint.
  const updateRow: Partial<Pick<CanonicalUser, 'role' | 'active'>> = {};
  if (patch.role !== undefined) updateRow.role = patch.role;
  if (patch.active !== undefined) updateRow.active = patch.active;

  let updated: Omit<CanonicalUser, 'pin_hash'> | null = target;
  if (Object.keys(updateRow).length > 0) {
    const { data, error: updErr } = await sb
      .from('users')
      .update(updateRow)
      .eq('id', targetId)
      .select('id, email, tenant_id, role, is_platform_admin, active, last_login_at')
      .single<Omit<CanonicalUser, 'pin_hash'>>();
    if (updErr || !data) {
      // eslint-disable-next-line no-console
      console.error('[edit-user] update failed:', updErr?.message);
      return jsonResponse(500, { ok: false, error: 'server-error' });
    }
    updated = data;
  }

  // Entitlements upsert (additive only — never disables existing).
  if (Array.isArray(patch.entitlements) && patch.entitlements.length > 0) {
    const rows = patch.entitlements
      .filter((v): v is string => typeof v === 'string')
      .map((mod) => ({
        tenant_id: session.tenant_id,
        module: mod,
        enabled: true,
      }));
    if (rows.length > 0) {
      const { error: entErr } = await sb
        .from('module_entitlements')
        .upsert(rows, { onConflict: 'tenant_id,module', ignoreDuplicates: true });
      if (entErr) {
        // eslint-disable-next-line no-console
        console.warn('[edit-user] entitlement upsert failed (non-fatal):', entErr.message);
      }
    }
  }

  return jsonResponse(200, { ok: true, user: updated });
});
