import type { EqRole } from '../../session';

export const FIELD_PERMS = [
  'field.view',     // Access the Field module
  'field.dispatch', // Create / edit staff assignments and schedules
] as const;

export type FieldPermKey = (typeof FIELD_PERMS)[number];

export const FIELD_MATRIX: Record<EqRole, FieldPermKey[]> = {
  manager:     ['field.view', 'field.dispatch'],
  supervisor:  ['field.view', 'field.dispatch'],
  employee:    ['field.view'],
  apprentice:  ['field.view'],
  labour_hire: ['field.view'],
};
