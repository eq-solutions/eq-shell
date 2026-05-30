/**
 * Master permission matrix â€” Phase 1.F (unified identity).
 *
 * This file is the SINGLE place that knows what every role can do
 * across every module. Per-module `permissions.ts` files (added in
 * each module's first PR) contribute their keys + tier-mapping here.
 *
 * Convention (per IDENTITY-MODEL.md Â§4.2):
 *   <module>.<verb>[_<scope>]
 *
 *   - module    â€” lowercase singular (admin, field, intake, cards,
 *                 quotes, service, tender)
 *   - verb      â€” present tense lowercase (view, create, edit, delete,
 *                 approve, import, export, issue, assign, invite, etc.)
 *   - scope     â€” optional qualifier (_self, _team, _tenant, _all)
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

import type { EqRole } from '@eq-solutions/roles';
import { MATRIX as ROLES_MATRIX } from '@eq-solutions/roles';
import { INTAKE_PERMS, INTAKE_MATRIX, type IntakePermKey } from '../modules/intake/permissions';
import { EQUIPMENT_PERMS, EQUIPMENT_MATRIX, type EquipmentPermKey } from '../modules/equipment/permissions';
import { GM_REPORTS_PERMS, GM_REPORTS_MATRIX, type GmReportsPermKey } from '../modules/gm-reports/permissions';

// ============================================================================
// ADMIN + AUDIT permission keys â€” sourced from @eq-solutions/roles
// ============================================================================
//
// The canonical admin and audit perm keys + grants live in the roles package.
// We pull them directly from ROLES_MATRIX so there is exactly one definition.
// The local INTAKE/EQUIPMENT/GM_REPORTS module matrices are Shell-specific and
// stay local until they are promoted into the package.

const ADMIN_PERMS = [
  'admin.list_users',
  'admin.invite_user',
  'admin.edit_user',
  'admin.deactivate_user',
  'admin.review_cards',
] as const;

type AdminPermKey = (typeof ADMIN_PERMS)[number];

const AUDIT_PERMS = ['audit.view', 'audit.rollback'] as const;

type AuditPermKey = (typeof AUDIT_PERMS)[number];

// ============================================================================
// MASTER LIST + TYPE
// ============================================================================

export const ALL_PERMS = [...ADMIN_PERMS, ...AUDIT_PERMS, ...INTAKE_PERMS, ...EQUIPMENT_PERMS, ...GM_REPORTS_PERMS] as const;

export type PermKey = AdminPermKey | AuditPermKey | IntakePermKey | EquipmentPermKey | GmReportsPermKey;

// ============================================================================
// PER-ROLE GRANTS â€” composed from module-local matrices
// ============================================================================
//
// Every role's grants are explicit. No inheritance â€” a manager doesn't
// "automatically" have supervisor perms because the implementation says
// so; they have them because the matrix lists them. Keeps every
// permission decision explicit + auditable in PR review.
//
// Admin + audit perms are pulled from the canonical roles package matrix
// (ROLES_MATRIX) so Shell and the package always agree. The filter keeps
// only the keys that belong to those two modules, typed as PermKey.

function rolesAdminAudit(role: EqRole): PermKey[] {
  return (ROLES_MATRIX[role] as readonly string[]).filter(
    (p): p is PermKey => p.startsWith('admin.') || p.startsWith('audit.'),
  );
}

function compose(role: EqRole): Set<PermKey> {
  return new Set<PermKey>([
    ...rolesAdminAudit(role),
    ...INTAKE_MATRIX[role],
    ...EQUIPMENT_MATRIX[role],
    ...GM_REPORTS_MATRIX[role],
  ]);
}

export const MATRIX: Record<EqRole, Set<PermKey>> = {
  manager:     compose('manager'),
  supervisor:  compose('supervisor'),
  employee:    compose('employee'),
  apprentice:  compose('apprentice'),
  labour_hire: compose('labour_hire'),
};