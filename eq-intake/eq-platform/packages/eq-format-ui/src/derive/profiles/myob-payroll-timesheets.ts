/**
 * `myob-payroll-timesheets` profile — MYOB AccountRight payroll timesheet import.
 *
 * Takes canonical timesheet rows and emits an MYOB AccountRight payroll
 * timesheet import CSV. Parallel to xero-payroll-timesheets but for MYOB.
 *
 * Output columns match MYOB AccountRight's Payroll → Timesheets → Import:
 *   Employee Card ID, Pay Period Start, Pay Period End, Earnings Category, Hours
 *
 * Input: canonical `timesheet` rows (from @eq/schemas timesheet.schema.json).
 * Rejected and already-paid timesheets are excluded.
 *
 * Earnings Category mapping (must match what's configured in MYOB Payroll):
 *   day / arvo / null / split → "Base Hourly"
 *   night                     → "Night Shift Allowance"
 *
 * MYOB uses the employee's Card ID (their payroll number in MYOB) to match
 * rows — this must be the MYOB CardID, not a name. Canonical timesheet rows
 * carry external_id on the staff record; for intake exports, the operator
 * should ensure their staff list was imported with MYOB Card IDs as external_id.
 * If no external_id is available, the profile falls back to first_name + last_name.
 *
 * Pay period dates: MYOB requires the same Start/End pair for all rows in a
 * batch (the pay period). This profile infers the period from the min/max dates
 * in the batch. If timesheets span multiple pay periods, split the input before
 * deriving — or the operator can override the dates in MYOB after import.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Employee Card ID',
  'Pay Period Start',
  'Pay Period End',
  'Earnings Category',
  'Hours',
];

const BASE_HOURLY   = 'Base Hourly';
const NIGHT_SHIFT   = 'Night Shift Allowance';

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  return Number(String(v).replace(/[$,\s]/g, '')) || 0;
}

function earningsCategory(shift: string): string {
  if (shift === 'night') return NIGHT_SHIFT;
  return BASE_HOURLY;
}

function cardId(r: Record<string, unknown>): string {
  // Use staff external_id (MYOB Card ID) if present; fall back to name.
  const ext = str(r.staff_external_id) || str(r.external_id) || str(r.card_id) || str(r.payroll_id);
  if (ext) return ext;
  const first = str(r.first_name) || str(r.preferred_name);
  const last  = str(r.last_name);
  return `${first} ${last}`.trim() || str(r.staff_id);
}

export const myobPayrollTimesheetsProfile: DeriveProfile = {
  id: 'myob-payroll-timesheets',
  label: 'MYOB Payroll — Timesheet Import',
  description:
    'MYOB AccountRight payroll timesheet import CSV. One row per timesheet entry. ' +
    'Employee Card ID must match the MYOB CardID (usually staff external_id). ' +
    'Pay period dates are inferred from the min/max dates in the batch.',
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    // Exclude rejected and already-paid timesheets.
    const eligible = rows.filter((r) => {
      const status = str(r.status).toLowerCase();
      return status !== 'rejected' && status !== 'paid';
    });

    if (eligible.length === 0) {
      return { columns: COLUMNS, rows: [] };
    }

    // Infer pay period bounds from the date range in the batch.
    const dates = eligible
      .map((r) => str(r.date) || str(r.work_date))
      .filter(Boolean)
      .sort();
    const periodStart = dates[0] ?? '';
    const periodEnd   = dates[dates.length - 1] ?? '';

    const mapped = eligible.map((r) => ({
      'Employee Card ID':  cardId(r),
      'Pay Period Start':  periodStart,
      'Pay Period End':    periodEnd,
      'Earnings Category': earningsCategory(str(r.shift).toLowerCase()),
      'Hours':             num(r.hours).toFixed(2),
    }));

    // Sort by Employee Card ID → Date for natural payroll review order.
    const sorted = [...mapped].sort((a, b) =>
      a['Employee Card ID'].localeCompare(b['Employee Card ID'])
    );

    return { columns: COLUMNS, rows: sorted };
  },
};
