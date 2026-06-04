// Local copy of the @eq-solutions/roles default security-group templates,
// mirrored verbatim from that package's roles.json `defaultGroups`.
//
// WHY A LOCAL COPY: identical reasoning to roles-matrix.ts — Netlify's function
// bundler externalizes the @eq-solutions/roles package (installed from a GitHub
// tarball) and ships its raw source, so importing the package at function
// runtime fails. A module local to the functions tree is always bundled in, so
// it is safe.
//
// SINGLE SOURCE OF TRUTH stays @eq-solutions/roles: scripts/check-perm-sync.mjs
// asserts this list is identical to the package's roles.json `defaultGroups` and
// fails CI on drift. Keep descriptions on a single line so the drift guard can
// parse them.

import type { PermKey } from '@eq-solutions/roles';

export interface DefaultGroup {
  key: string;
  name: string;
  description: string;
  perms: readonly PermKey[];
}

export const DEFAULT_GROUPS: readonly DefaultGroup[] = [
  {
    key: 'equipment_editors',
    name: 'Equipment editors',
    description: 'Edit the plant & equipment list and calibration details. Add people here who maintain equipment but whose role normally only lets them view it.',
    perms: ['equipment.view', 'equipment.edit'],
  },
  {
    key: 'report_viewers',
    name: 'Report viewers',
    description: 'View GM reports without being made a manager. Add supervisors or leads here who need to read reports.',
    perms: ['reports.view'],
  },
];
