import type { EqRole } from '../../session';

export const GM_REPORTS_PERMS = [
  'reports.view',
  'reports.upload',
  'reports.generate_briefing',
] as const;

export type GmReportsPermKey = (typeof GM_REPORTS_PERMS)[number];

export const GM_REPORTS_MATRIX: Record<EqRole, GmReportsPermKey[]> = {
  manager:     ['reports.view', 'reports.upload', 'reports.generate_briefing'],
  supervisor:  [],
  employee:    [],
  apprentice:  [],
  labour_hire: [],
};
