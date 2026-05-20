// Permission keys + tier-mapping for the Intake module (Phase 1.F).
//
// Per IDENTITY-MODEL.md §4.3, each module owns its own permissions.ts
// file. The master matrix at src/permissions/matrix.ts composes
// these into a tenant-wide Record<EqRole, Set<PermKey>>.
//
// Pattern: export a `const PERMS` of perm keys + `MATRIX` mapping
// each EqRole to the subset it holds. Both are imported by the
// master matrix at build time.

import type { EqRole } from '../../session';

export const INTAKE_PERMS = [
  /**
   * See the Intake surface at all. Default for every authenticated
   * user — Intake is currently view-by-default; gating tightens
   * later when the bulk-import UI lands.
   */
  'intake.view',
  /**
   * Initiate an import (drop a file, choose mapping, validate). Held
   * by anyone who works with intake data — supervisors, managers,
   * employees on the receiving end of a CRM export.
   */
  'intake.import',
  /**
   * Commit the validated batch to canonical via
   * eq_intake_commit_batch. The destructive step. Supervisors +
   * managers only; an employee can stage but not commit.
   */
  'intake.commit',
] as const;

export type IntakePermKey = (typeof INTAKE_PERMS)[number];

export const INTAKE_MATRIX: Record<EqRole, IntakePermKey[]> = {
  manager:     ['intake.view', 'intake.import', 'intake.commit'],
  supervisor:  ['intake.view', 'intake.import', 'intake.commit'],
  employee:    ['intake.view', 'intake.import'],
  apprentice:  ['intake.view'],
  labour_hire: [],
};
