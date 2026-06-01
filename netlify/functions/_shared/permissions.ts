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
// The grants below mirror src/modules/*/permissions.ts (intake, equipment,
// gm-reports) plus the admin/audit grants in @eq-solutions/roles. They are
// duplicated here deliberately: the browser matrix lives in the `src` TS
// project, and a Netlify function can't import across the composite tsconfig
// boundary (tsconfig.netlify is its own project; tsconfig.app is `noEmit` so it
// can't be referenced as a composite dep). Single-sourcing both behind one
// shared definition is a tracked follow-up (roadmap B12). UNTIL THEN: any grant
// change in src/modules/*/permissions.ts or @eq-solutions/roles MUST be
// mirrored here, or client and server will disagree.

import type { EqRole } from './supabase.js';

/**
 * Closed union of every server-enforced permission. Mirrors ALL_PERMS in
 * src/permissions/matrix.ts.
 */
// prettier-ignore
export type PermKey =
  // admin
  | 'admin.list_users' | 'admin.invite_user' | 'admin.edit_user'
  | 'admin.deactivate_user' | 'admin.review_cards' | 'admin.manage_groups'
  // audit
  | 'audit.view' | 'audit.rollback'
  // entity (canonical records — customers/sites/contacts/assets)
  | 'entity.view' | 'entity.create' | 'entity.edit' | 'entity.delete'
  // intake
  | 'intake.view' | 'intake.import' | 'intake.commit'
  // equipment
  | 'equipment.view' | 'equipment.edit'
  // reports
  | 'reports.view' | 'reports.upload' | 'reports.generate_briefing'
  // cards
  | 'cards.view' | 'cards.onboard'
  // service
  | 'service.view' | 'service.create' | 'service.close'
  // field
  | 'field.view' | 'field.dispatch'
  // quotes
  | 'quotes.view' | 'quotes.create' | 'quotes.approve';

// Per-role grants. Omitting a perm denies it; there is no inheritance — every
// grant is explicit, matching the client matrix's invariant. A manager holds
// supervisor's perms because they are listed, not by implication.
// Mirror of src/permissions/matrix.ts — kept in sync manually until B12 (single-source)
// lands. If you change grants here, change the client matrix too (and vice-versa).
// The drift-guard script scripts/check-perm-sync.mjs will catch divergence in CI.
const MATRIX: Record<EqRole, ReadonlySet<PermKey>> = {
  manager: new Set<PermKey>([
    'admin.list_users', 'admin.invite_user', 'admin.edit_user',
    'admin.deactivate_user', 'admin.review_cards', 'admin.manage_groups',
    'audit.view', 'audit.rollback',
    'entity.view', 'entity.create', 'entity.edit', 'entity.delete',
    'intake.view', 'intake.import', 'intake.commit',
    'equipment.view', 'equipment.edit',
    'reports.view', 'reports.upload', 'reports.generate_briefing',
    'cards.view', 'cards.onboard',
    'service.view', 'service.create', 'service.close',
    'field.view', 'field.dispatch',
    'quotes.view', 'quotes.create', 'quotes.approve',
  ]),
  supervisor: new Set<PermKey>([
    'audit.view',
    'entity.view', 'entity.edit',
    'intake.view', 'intake.import', 'intake.commit',
    'equipment.view', 'equipment.edit',
    'cards.view', 'cards.onboard',
    'service.view', 'service.create', 'service.close',
    'field.view', 'field.dispatch',
    'quotes.view', 'quotes.create',
  ]),
  employee: new Set<PermKey>([
    'entity.view',
    'intake.view', 'intake.import',
    'equipment.view',
    'cards.view',
    'service.view',
    'field.view',
    'quotes.view',
  ]),
  apprentice: new Set<PermKey>([
    'entity.view',
    'intake.view',
    'cards.view',
    'service.view',
    'field.view',
  ]),
  labour_hire: new Set<PermKey>([
    'field.view',
  ]),
};

/**
 * A principal derived from either auth path: the session cookie
 * (SessionPayload) or a verified Supabase JWT (app_metadata). Both carry a role
 * and the platform-admin flag — though the JWT's are optional, since a
 * Supabase-native token may omit eq_role until the auth hook injects it.
 */
export interface Principal {
  role?: EqRole | null;
  is_platform_admin?: boolean | null;
  /** Extra permission keys granted via security groups. */
  extra_perms?: string[] | null;
}

/**
 * Can this principal perform `perm`? Mirrors the browser useCan(): platform
 * admins short-circuit to true; a missing or unrecognised role is denied.
 * Security-group extra_perms are checked before the role matrix.
 */
export function can(principal: Principal, perm: PermKey): boolean {
  if (principal.is_platform_admin === true) return true;
  if (principal.extra_perms?.includes(perm)) return true;
  const role = principal.role;
  if (!role) return false;
  const grants = MATRIX[role];
  return grants ? grants.has(perm) : false;
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
