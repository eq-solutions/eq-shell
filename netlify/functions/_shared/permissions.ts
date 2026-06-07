// Server-side authorization for EQ Shell Netlify functions.
//
// WHY THIS EXISTS
// The browser gates UI with src/permissions (useCan / <Gate>), but a browser
// can't enforce anything — every mutating function must make its own
// authorization decision. Historically each function hand-rolled a
// `session.role !== 'manager'` check, which is how intake-commit shipped with
// no server gate at all (any signed-in user could commit/replace tenant data).
// This module is the single server-side authority: one matrix, one can(), one
// requirePerm().
//
// SOURCE OF TRUTH
// The matrix is now delegated to @eq-solutions/roles (B12). This module owns
// the Principal interface and the server-side can() wrapper that handles the
// is_platform_admin short-circuit and extra_perms extension points.

// Effective permissions are resolved by @eq-solutions/roles (the single source
// of truth). As of v2.3.0 the package ships a compiled `roles.js` as its default
// export condition, so Netlify functions can import it at runtime — the prior
// bundling trap (default condition resolved to raw `.ts` → 502 on load) is gone.
// This retires the old local `roles-matrix.ts` hand-copy.
import { resolveEffectivePermissions } from '@eq-solutions/roles';
import type { PermKey } from '@eq-solutions/roles';
export type { PermKey } from '@eq-solutions/roles';
import type { EqRole } from './supabase.js';

/**
 * A principal derived from either auth path: the session cookie
 * (SessionPayload) or a verified Supabase JWT (app_metadata). Both carry a role
 * and the platform-admin flag — though the JWT's are optional, since a
 * Supabase-native token may omit eq_role until the auth hook injects it.
 * extra_perms allows one-off grants without a role (e.g. guest invites).
 */
export interface Principal {
  role?: EqRole | null;
  is_platform_admin?: boolean | null;
  extra_perms?: string[] | null;
  /**
   * Permission keys explicitly denied by tenant role overrides. Applied
   * after is_platform_admin short-circuit, before role defaults + group grants.
   * Populated by verify-shell-session from shell_control.tenant_role_overrides.
   */
  denied_perms?: string[] | null;
}

/**
 * Can this principal perform `perm`? Mirrors the browser useCan(): platform
 * admins short-circuit to true; denied_perms trumps role defaults + group
 * grants; otherwise the package resolves role-defaults ∪ group grants.
 */
export function can(principal: Principal, perm: PermKey): boolean {
  if (principal.is_platform_admin === true) return true;
  if (principal.denied_perms?.includes(perm)) return false;
  const effective = resolveEffectivePermissions({
    // Cast: the package types `role` as required, but its runtime tolerates an
    // absent role (a no-role principal still gets its group grants).
    role: (principal.role ?? undefined) as EqRole,
    groupPerms: (principal.extra_perms ?? undefined) as readonly PermKey[] | undefined,
  });
  return effective.includes(perm);
}

/**
 * Authorization guard for a function handler. Returns a 403 Response when the
 * principal lacks `perm`, or null to continue. The body is deliberately generic
 * ({ ok:false, error:'forbidden' }) so it never leaks which role or permission
 * was required. Functions with a bespoke response shape can call can() directly
 * and build their own 403 instead.
 */
export function requirePerm(principal: Principal, perm: PermKey): Response | null {
  if (can(principal, perm)) return null;
  return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
