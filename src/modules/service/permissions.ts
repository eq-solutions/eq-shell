import type { EqRole } from '../../session';

export const SERVICE_PERMS = [
  'service.view',   // Access the Service/CMMS module
  'service.create', // Create work orders and defects
  'service.close',  // Close / complete work orders
] as const;

export type ServicePermKey = (typeof SERVICE_PERMS)[number];

export const SERVICE_MATRIX: Record<EqRole, ServicePermKey[]> = {
  manager:     ['service.view', 'service.create', 'service.close'],
  supervisor:  ['service.view', 'service.create', 'service.close'],
  employee:    ['service.view'],
  apprentice:  ['service.view'],
  labour_hire: [],
};
