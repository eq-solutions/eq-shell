/**
 * Master permission matrix — Phase 1.F (unified identity).
 *
 * This file is the SINGLE place that knows what every role can do
 * across every module. Per-module `permissions.ts` files (added in
 * each module's first PR) contribute their keys + tier-mapping here.
 *
 * Convention (per IDENTITY-MODEL.md §4.2):
 *   <module>.<verb>[_<scope>]
 *
 *   - module    — lowercase singular (admin, field, intake, cards,
 *                 quotes, service, tender)
 *   - verb      — present tense lowercase (view, create, edit, delete,
 *                 approve, import, export, issue, assign, invite, etc.)
 *   - scope     — optional qualifier (_self, _team, _tenant, _all)
 *
 * Same verb across modules means the same kind of operation.
 *
 * Type-level invariant: `PermKey` is the closed union of every string
 * literal in `ALL_PERMS`. Typing `useCan('field.does_not_exist')` fails
 * to compile.
 *
 * Adding new permissions:
 *   1. Append the literal to the module's perm-key array below.
 *   2. Add it to each EqRole's set in MATRIX (omit a role to deny it).
 *   3. The PermKey union widens automatically.
 *
 * When a new module ships, move its perm-key array + matrix
 * contributions into `src/modules/<module>/permissions.ts` and import
 * here. The shape established below is the template for that.
 */

import type { EqRole } from '../session';
import { INTAKE_PERMS, INTAKE_MATRIX, type IntakePermKey } from '../modules/intake/permissions';
import { EQUIPMENT_PERMS, EQUIPMENT_MATRIX, type EquipmentPermKey } from '../modules/equipment/permissions';

// ============================================================================
// ADMIN permission keys (Phase 1.F seeds — user management)
// ============================================================================
//
// Admin keys live here rather than in a `src/modules/admin/` directory
// because there's no admin "module" surface — admin UI is part of the
// shell itself (TenantHome / AdminUserList / AdminInviteUser /
// AdminEditUser). When the admin surface grows enough to warrant its
// own module, this block moves to `src/admin/permissions.ts`.
//
// Manager + platform_admin only — see IDENTITY-MODEL.md §5.

const ADMIN_PERMS = [
  'admin.list_users',
  'admin.invite_user',
  'admin.edit_user',
  'admin.deactivate_user',
  'admin.review_cards',
] as const;

type AdminPermKey = (typeof ADMIN_PERMS)[number];

const ADMIN_MATRIX: Record<EqRole, AdminPermKey[]> = {
  manager:     ['admin.list_users', 'admin.invite_user', 'admin.edit_user', 'admin.deactivate_user', 'admin.review_cards'],
  supervisor:  [],
  employee:    [],
  apprentice:  [],
  labour_hire: [],
};

// ============================================================================
// AUDIT permission keys (S2.D + S3 — audit log viewer + rollback)
// ============================================================================

const AUDIT_PERMS = ['audit.view', 'audit.rollback'] as const;

type AuditPermKey = (typeof AUDIT_PERMS)[number];

const AUDIT_MATRIX: Record<EqRole, AuditPermKey[]> = {
  manager:     ['audit.view', 'audit.rollback'],
  supervisor:  ['audit.view'],
  employee:    [],
  apprentice:  [],
  labour_hire: [],
};

// ============================================================================
// MASTER LIST + TYPE
// ============================================================================
//
// New modules contribute their PERMS array + MATRIX record. The master
// composes them into a single closed union (PermKey) and a single
// per-role Set lookup (MATRIX). Adding a module is one import + one
// concat per role.

export const ALL_PERMS = [...ADMIN_PERMS, ...AUDIT_PERMS, ...INTAKE_PERMS, ...EQUIPMENT_PERMS] as const;

export type PermKey = AdminPermKey | AuditPermKey | IntakePermKey | EquipmentPermKey;

// ============================================================================
// PER-ROLE GRANTS — composed from module-local matrices
// ============================================================================
//
// Every role's grants are explicit. No inheritance — a manager doesn't
// "automatically" have supervisor perms because the implementation says
// so; they have them because the matrix lists them. Keeps every
// permission decision explicit + auditable in PR review.

function compose(role: EqRole): Set<PermKey> {
  return new Set<PermKey>([
    ...ADMIN_MATRIX[role],
    ...AUDIT_MATRIX[role],
    ...INTAKE_MATRIX[role],
    ...EQUIPMENT_MATRIX[role],
  ]);
}

export const MATRIX: Record<EqRole, Set<PermKey>> = {
  manager:     compose('manager'),
  supervisor:  compose('supervisor'),
  employee:    compose('employee'),
  apprentice:  compose('apprentice'),
  labour_hire: compose('labour_hire'),
};
