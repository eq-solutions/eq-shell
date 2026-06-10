/**
 * `xero-payroll-timesheets` profile — Xero Payroll timesheet import format.
 *
 * Takes canonical timesheet rows (validated by EQ Format) and emits a
 * Xero Payroll timesheet import CSV. The "Friday problem": Royce manually
 * re-enters hours into Xero every week. This profile closes that loop.
 *
 * Output columns match Xero Payroll's timesheet import template:
 *   Employee, Date, Hours, Earnings Rate, Notes
 *
 * Input: canonical `timesheet` rows (from @eq/schemas timesheet.schema.json).
 * Only rows with status = approved | submitted | draft are included.
 * Rejected and paid rows are excluded (paid already landed in Xero; rejected
 * should not go through).
 *
 * Earnings Rate mapping (Xero's internal pay item names must match exactly
 * what the tenant has configured in Xero Payroll — these are the most
 * common defaults for Australian trade businesses):
 *   day / arvo / null → "Ordinary Time Earnings"
 *   night             → "Night Shift Allowance"
 *   split             → "Ordinary Time Earnings"  (user can override)
 *
 * If hours > 8 on a single row, the excess is flagged in the Notes column
 * so the payroll officer can split it manually if overtime rates apply.
 * EQ does not auto-split to overtime — that decision belongs to the operator.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Employee',
  'Date',
  'Hours',
  'Earnings Rate',
  'Notes',
];

const ORDINARY = 'Ordinary Time Earnings';
const NIGHT    = 'Night Shift Allowance';

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  return Number(String(v).replace(/[$,\s]/g, '')) || 0;
}

function earningsRate(shift: string): string {
  if (shift === 'night') return NIGHT;
  return ORDINARY;
}

function employeeName(r: Record<string, unknown>): string {
  const first = str(r.first_name) || str(r.preferred_name);
  const last  = str(r.last_name);
  if (first || last) return `${first} ${last}`.trim();
  // Fall back to staff_id if no name columns present — payroll officer can
  // look up the staff member. Prefixed with "Staff:" so it's obvious.
  return `Staff:${str(r.staff_id)}`;
}

export const xeroPayrollTimesheetsProfile: DeriveProfile = {
  id: 'xero-payroll-timesheets',
  label: 'Xero Payroll — Timesheet Import',
  description:
    'Xero Payroll timesheet import CSV. One row per approved/submitted ' +
    'timesheet entry. Maps to Employee, Date, Hours, Earnings Rate, Notes. ' +
    'Rejected and already-paid rows are excluded.',
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    // Exclude rejected and already-paid timesheets.
    const eligible = rows.filter((r) => {
      const status = str(r.status).toLowerCase();
      return status !== 'rejected' && status !== 'paid';
    });

    const mapped = eligible.map((r) => {
      const hours = num(r.hours);
      const shift = str(r.shift).toLowerCase();
      const task  = str(r.task);

      // Flag likely-overtime rows in Notes so the payroll officer can review.
      const overtimeNote = hours > 8
        ? `${hours}h total — check for overtime split. `
        : '';

      return {
        'Employee':      employeeName(r),
        'Date':          str(r.date) || str(r.work_date),
        'Hours':         hours.toFixed(2),
        'Earnings Rate': earningsRate(shift),
        'Notes':         (overtimeNote + task).trim(),
      };
    });

    // Sort by Employee → Date — matches the natural payroll review order.
    const sorted = [...mapped].sort((a, b) => {
      const emp = a['Employee'].localeCompare(b['Employee']);
      if (emp !== 0) return emp;
      return a['Date'].localeCompare(b['Date']);
    });

    return { columns: COLUMNS, rows: sorted };
  },
};
