// Permission keys for the Plant & Equipment module (calibration tracking v0).
//
// Per IDENTITY-MODEL.md §4.3, each module owns its own permissions.ts file;
// the master matrix at src/permissions/matrix.ts composes these into the
// tenant-wide Record<EqRole, Set<PermKey>>.

import type { EqRole } from '../../session';

export const EQUIPMENT_PERMS = [
  /**
   * See the Plant & Equipment list — items, calibration due dates, and
   * certificate links. Granted broadly so any field tech can check whether a
   * meter is in calibration before using it.
   */
  'equipment.view',
  /**
   * Add an item and edit its calibration fields (last done, next due,
   * interval, certificate link). Supervisors + managers only — employees can
   * see status but not change the record.
   */
  'equipment.edit',
] as const;

export type EquipmentPermKey = (typeof EQUIPMENT_PERMS)[number];

export const EQUIPMENT_MATRIX: Record<EqRole, EquipmentPermKey[]> = {
  manager:     ['equipment.view', 'equipment.edit'],
  supervisor:  ['equipment.view', 'equipment.edit'],
  employee:    ['equipment.view'],
  apprentice:  [],
  labour_hire: [],
};
