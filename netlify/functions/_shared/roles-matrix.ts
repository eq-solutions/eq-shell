// Local copy of the @eq-solutions/roles permission matrix, mirrored verbatim
// from that package's roles.json.
//
// WHY A LOCAL COPY: Netlify's function bundler externalizes the
// @eq-solutions/roles package (installed from a GitHub tarball) and ships its
// raw source files, so importing the package at function runtime fails — the
// `.ts` entry hits ERR_UNKNOWN_FILE_EXTENSION, and a JSON entry hits
// ERR_IMPORT_ASSERTION_TYPE_MISSING. A module local to the functions tree is
// always bundled in, so it is safe. The browser side does the same thing
// (src/permissions/matrix.ts keeps its own copy).
//
// SINGLE SOURCE OF TRUTH stays @eq-solutions/roles: scripts/check-perm-sync.mjs
// asserts this MATRIX is identical to the package's roles.json and fails CI on
// drift. Regenerate with: node scripts/check-perm-sync.mjs (it prints the diff).

import type { EqRole } from './supabase.js';
import type { PermKey } from '@eq-solutions/roles';

export const MATRIX: Record<EqRole, readonly PermKey[]> = {
  manager: [
    'admin.list_users',
    'admin.invite_user',
    'admin.edit_user',
    'admin.deactivate_user',
    'admin.review_cards',
    'admin.manage_groups',
    'audit.view',
    'audit.rollback',
    'entity.view',
    'entity.create',
    'entity.edit',
    'entity.delete',
    'intake.view',
    'intake.import',
    'intake.commit',
    'equipment.view',
    'equipment.edit',
    'reports.view',
    'reports.upload',
    'reports.generate_briefing',
    'cards.view',
    'cards.onboard',
    'service.view',
    'service.create',
    'service.close',
    'field.view',
    'field.dispatch',
    'quotes.view',
    'quotes.create',
    'quotes.approve',
  ],
  supervisor: [
    'audit.view',
    'entity.view',
    'entity.edit',
    'intake.view',
    'intake.import',
    'intake.commit',
    'equipment.view',
    'equipment.edit',
    'cards.view',
    'cards.onboard',
    'service.view',
    'service.create',
    'service.close',
    'field.view',
    'field.dispatch',
    'quotes.view',
    'quotes.create',
  ],
  employee: [
    'entity.view',
    'intake.view',
    'intake.import',
    'equipment.view',
    'cards.view',
    'service.view',
    'field.view',
    'quotes.view',
  ],
  apprentice: [
    'entity.view',
    'intake.view',
    'cards.view',
    'service.view',
    'field.view',
  ],
  labour_hire: [
    'field.view',
  ],
};
