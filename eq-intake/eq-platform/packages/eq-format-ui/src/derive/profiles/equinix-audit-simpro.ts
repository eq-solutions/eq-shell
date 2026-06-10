/**
 * `equinix-audit-simpro` profile — Equinix audit export → SimPRO job completion.
 *
 * Takes a raw Equinix data-centre audit export (one row per asset × test) and
 * reshapes it into a SimPRO-compatible job completion format.
 *
 * This is the Equinix 3-hour-to-20-minute use case: after SKS NSW runs an
 * annual audit at Equinix SY-3, the audit tool produces a CSV. This profile
 * converts that CSV into the format SimPRO needs for closing the job sections.
 *
 * ── Input shape (raw Equinix audit CSV) ────────────────────────────────────
 * Equinix's standard audit export columns (varies slightly by facility):
 *   Site, Asset ID, Asset Name, Location, Room, Category, Make, Model,
 *   Serial Number, Last Test Date, Next Test Date, Test Type, Test Result,
 *   Technician, Licence No, Pass/Fail, Notes, Client Reference
 *
 * ── Output shape (SimPRO job completion) ───────────────────────────────────
 * One row per completed asset test, grouped by Section (test type category)
 * and Cost Centre (site/room grouping). Paste into SimPRO's job completion
 * CSV import, or attach as the job completion record.
 *
 * Columns:
 *   Site, Section, Cost Centre, Asset ID, Asset Name, Location, Test Type,
 *   Test Date, Result, Pass/Fail, Technician, Licence No, Notes, Client Ref
 *
 * ── Section grouping ────────────────────────────────────────────────────────
 * Equinix audit jobs in SimPRO are typically sectioned by test type:
 *   "Annual DB Maintenance" → section "Switchboard Maintenance"
 *   "Thermal Scan" → section "Thermal Imaging"
 *   "RCD Test" → section "RCD Testing"
 *   "Generator Run" → section "Generator Testing"
 *   etc.
 *
 * The profile normalises the raw Equinix "Test Type" into one of these
 * SimPRO section names. Unknown test types pass through verbatim.
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Site',
  'Section',
  'Cost Centre',
  'Asset ID',
  'Asset Name',
  'Location',
  'Test Type',
  'Test Date',
  'Result',
  'Pass/Fail',
  'Technician',
  'Licence No',
  'Notes',
  'Client Reference',
];

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Normalise Equinix test type labels to SimPRO section names.
 * Equinix uses their own taxonomy; SimPRO jobs are sectioned by trade activity.
 */
function normaliseSection(testType: string): string {
  const t = testType.toLowerCase();
  if (t.includes('thermal') || t.includes('infrared') || t.includes('ir scan')) {
    return 'Thermal Imaging';
  }
  if (t.includes('rcd') || t.includes('earth leakage') || t.includes('elcb') || t.includes('trip')) {
    return 'RCD Testing';
  }
  if (t.includes('switchboard') || t.includes('msb') || t.includes('db maint') || t.includes('annual db')) {
    return 'Switchboard Maintenance';
  }
  if (t.includes('generator') || t.includes('gen run') || t.includes('genset')) {
    return 'Generator Testing';
  }
  if (t.includes('ups') || t.includes('uninterruptible')) {
    return 'UPS Maintenance';
  }
  if (t.includes('battery') || t.includes('load test')) {
    return 'Battery Testing';
  }
  if (t.includes('megger') || t.includes('insulation') || t.includes('meg test')) {
    return 'Insulation Resistance Testing';
  }
  if (t.includes('earth continuity') || t.includes('earth test') || t.includes('continuity')) {
    return 'Earth Continuity Testing';
  }
  if (t.includes('polarity')) {
    return 'Polarity Testing';
  }
  if (t.includes('visual') || t.includes('inspection')) {
    return 'Visual Inspection';
  }
  // Return verbatim if unrecognised — don't silently change unknown types.
  return testType || 'General';
}

/**
 * Normalise pass/fail values to a clean "Pass" / "Fail" / "" string.
 * Equinix tools use inconsistent capitalisation and abbreviations.
 */
function normalisePassFail(raw: string): string {
  const v = raw.toLowerCase().trim();
  if (v === 'pass' || v === 'p' || v === 'ok' || v === 'satisfactory' || v === 'sat') return 'Pass';
  if (v === 'fail' || v === 'f' || v === 'failed' || v === 'unsatisfactory' || v === 'unsat') return 'Fail';
  if (v === 'n/a' || v === 'na' || v === 'not applicable') return 'N/A';
  return raw;
}

export const equinixAuditSimproProfile: DeriveProfile = {
  id: 'equinix-audit-simpro',
  label: 'Equinix Audit → SimPRO',
  description:
    'Converts an Equinix data-centre audit export into a SimPRO job completion format. ' +
    'Normalises Equinix test types into SimPRO section names. ' +
    'Sorted by Section → Site → Asset for pasting into a SimPRO job completion record.',
  inputShape: 'raw',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    const mapped = rows.map((r) => {
      // Handle Equinix column name variants (different facilities use different headers)
      const site     = str(r['Site'])            || str(r['Facility'])      || str(r['Data Centre']) || str(r['DC']);
      const assetId  = str(r['Asset ID'])        || str(r['Tag'])           || str(r['Asset Tag'])   || str(r['Equipment ID']);
      const assetName = str(r['Asset Name'])     || str(r['Description'])   || str(r['Equipment']);
      const location = str(r['Location'])        || str(r['Room'])          || str(r['Rack'])        || str(r['Floor / Room']);
      const testType = str(r['Test Type'])       || str(r['Activity'])      || str(r['Service Type']) || str(r['Task']);
      const testDate = str(r['Last Test Date'])  || str(r['Test Date'])     || str(r['Date'])        || str(r['Date Completed']);
      const result   = str(r['Test Result'])     || str(r['Result'])        || str(r['Outcome']);
      const passFail = normalisePassFail(
        str(r['Pass/Fail']) || str(r['Result']) || str(r['Outcome']) || ''
      );
      const tech     = str(r['Technician'])      || str(r['Engineer'])      || str(r['Performed By']);
      const licenceNo = str(r['Licence No'])     || str(r['License No'])    || str(r['Lic No'])      || str(r['Electrical Licence']);
      const notes    = str(r['Notes'])           || str(r['Comments'])      || str(r['Findings']);
      const clientRef = str(r['Client Reference']) || str(r['Client Ref'])  || str(r['PO Number'])   || str(r['Job No']);

      const section  = normaliseSection(testType);

      // Cost Centre = location within site (room/rack). Equinix jobs in
      // SimPRO typically use the room as the cost centre grouping.
      const costCentre = location || site || 'General';

      return {
        'Site':             site,
        'Section':          section,
        'Cost Centre':      costCentre,
        'Asset ID':         assetId,
        'Asset Name':       assetName,
        'Location':         location,
        'Test Type':        testType,
        'Test Date':        testDate,
        'Result':           result,
        'Pass/Fail':        passFail,
        'Technician':       tech,
        'Licence No':       licenceNo,
        'Notes':            notes,
        'Client Reference': clientRef,
      };
    });

    // Sort by Section → Site → Location → Asset Name for a structured completion record.
    const sorted = [...mapped].sort((a, b) => {
      const sec = a['Section'].localeCompare(b['Section']);
      if (sec !== 0) return sec;
      const site = a['Site'].localeCompare(b['Site']);
      if (site !== 0) return site;
      const loc = a['Location'].localeCompare(b['Location']);
      if (loc !== 0) return loc;
      return a['Asset Name'].localeCompare(b['Asset Name']);
    });

    return { columns: COLUMNS, rows: sorted };
  },
};
