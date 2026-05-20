// Phase 1.F — useCan() hook + public permissions API.
//
// See `eq-context/eq/identity/IDENTITY-MODEL.md §4.2 + §4.3` for the
// authoritative spec. The matrix lives in `src/permissions/matrix.ts`;
// this file is the consumer surface every component imports.

import { useSession, type EqRole } from './session';
import { MATRIX, type PermKey } from './permissions/matrix';

export type { EqRole, PermKey };
export { MATRIX };

/**
 * Synchronous permission check. Reads the role + platform_admin flag
 * from SessionContext, looks up the static in-code matrix, returns a
 * boolean. No async, no fetch, no flash on render.
 *
 * Short-circuits to `true` for any permission when the user is a
 * platform admin — see IDENTITY-MODEL.md §3.1.
 *
 * Returns `false` when there's no session yet (loading state) — call
 * sites should also gate on session presence if they need a third
 * "loading" state.
 *
 * Usage:
 *
 *   const canInvite = useCan('admin.invite_user');
 *   return canInvite ? <InviteButton /> : null;
 */
export function useCan(perm: PermKey): boolean {
  const { session } = useSession();
  if (!session) return false;
  if (session.user.is_platform_admin) return true;
  return MATRIX[session.user.role].has(perm);
}
