/**
 * `equinix-contractor` profile — Equinix Australia contractor submission format.
 *
 * Takes canonical staff rows (from EQ Format validate run) and emits a
 * contractor register suitable for Equinix's contractor management portal.
 * Every worker entering an Equinix data centre must be pre-registered in
 * their portal with name, trade, company, and contact details.
 *
 * Output columns match the Equinix contractor portal CSV import template:
 *   First Name, Last Name, Email, Phone, Trade, Level, Employment Type,
 *   Company, Status, Notes
 *
 * Input: canonical `staff` rows (from @eq/schemas staff.schema.json).
 * Inactive staff (active = false) are excluded — only current workers
 * should appear in a live contractor submission.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Trade',
  'Level',
  'Employment Type',
  'Company',
  'Status',
  'Notes',
];

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function normaliseEmploymentType(raw: string): string {
  const v = raw.toLowerCase();
  if (v === 'subcontractor' || v === 'sub') return 'Subcontractor';
  if (v === 'labour_hire' || v === 'labour hire') return 'Labour Hire';
  if (v === 'casual') return 'Casual';
  if (v === 'apprentice') return 'Apprentice';
  return 'Employee';
}

export const equinixContractorProfile: DeriveProfile = {
  id: 'equinix-contractor',
  label: 'Equinix Contractor Register',
  description:
    'Equinix-formatted contractor register. One row per active staff member. ' +
    'Columns match the Equinix contractor portal CSV import template. ' +
    'Inactive staff are excluded automatically.',
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    // Exclude inactive workers — Equinix submissions are for current workers only.
    const active = rows.filter((r) => {
      const a = r.active;
      if (a === false || a === 'false' || a === 0 || a === 'no') return false;
      return true;
    });

    const mapped = active.map((r) => ({
      'First Name': str(r.first_name) || str(r.preferred_name),
      'Last Name':  str(r.last_name),
      'Email':      str(r.email),
      'Phone':      str(r.phone) || str(r.mobile),
      'Trade':      str(r.trade) || str(r.discipline),
      'Level':      str(r.level) || str(r.grade) || str(r.classification),
      'Employment Type': normaliseEmploymentType(
        str(r.employment_type) || str(r.type) || 'employee'
      ),
      'Company':    str(r.company) || str(r.employer) || str(r.home_base),
      'Status':     'Active',
      'Notes':      str(r.notes),
    }));

    // Sort by Last Name → First Name for a scannable register.
    const sorted = [...mapped].sort((a, b) => {
      const ln = a['Last Name'].localeCompare(b['Last Name']);
      if (ln !== 0) return ln;
      return a['First Name'].localeCompare(b['First Name']);
    });

    return { columns: COLUMNS, rows: sorted };
  },
};
