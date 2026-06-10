/**
 * `service-visit-schedule` profile — canonical service_visit rows → weekly schedule.
 *
 * Takes canonical `service_visit` rows and produces a printable weekly or
 * monthly schedule — the document that coordinators send to crews at the
 * start of each month to show what's booked, where, and who's going.
 *
 * Before: coordinator builds this from the master schedule spreadsheet by
 * hand — copies dates, fills in crew names, sends by email or WhatsApp.
 *
 * After: drop the service visits export into EQ Format, select this profile,
 * get the month's schedule in 30 seconds.
 *
 * ── Input shape (canonical service_visit rows) ──────────────────────────────
 * Expects validated canonical `service_visit` rows from
 * @eq/schemas service_visit.schema.json.
 * Key fields: visit_id, scheduled_date, actual_date, site_id, site_name,
 * client_job_code, status, crew_lead_id, crew_lead_name, expected_assets,
 * expected_circuits, logistics_notes.
 *
 * ── Output shape (weekly schedule) ────────────────────────────────────────────
 * One row per visit. Columns:
 *   Date, Site, Client Job Code, Crew Lead, Expected Assets,
 *   Expected Circuits, Status, Logistics Notes
 *
 * ── Sorting ──────────────────────────────────────────────────────────────────
 * Sorted by scheduled_date ascending, then site name — crews work through
 * the month in date order. Cancelled visits are shown last within their date
 * so they don't distract from active bookings.
 *
 * ── Status formatting ────────────────────────────────────────────────────────
 * planned      → Planned
 * in_progress  → In Progress
 * complete     → Complete ✓
 * cancelled    → Cancelled (moved to end of date group)
 */

import type { DeriveProfile, DeriveOutput } from '../types';

const COLUMNS = [
  'Date',
  'Site',
  'Client Job Code',
  'Crew Lead',
  'Expected Assets',
  'Expected Circuits',
  'Status',
  'Logistics Notes',
];

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

const STATUS_LABELS: Record<string, string> = {
  planned:     'Planned',
  in_progress: 'In Progress',
  complete:    'Complete ✓',
  cancelled:   'Cancelled',
};

const STATUS_SORT_ORDER: Record<string, number> = {
  in_progress: 0,
  planned:     1,
  complete:    2,
  cancelled:   3,
};

export const serviceVisitScheduleProfile: DeriveProfile = {
  id: 'service-visit-schedule',
  label: 'Service Visit Schedule',
  description:
    'Produces a monthly service visit schedule from canonical service_visit rows. ' +
    'One row per visit, sorted by date then status (active visits first). ' +
    "For coordinators and crew — shows what's booked, where, and who's going.",
  inputShape: 'canonical',

  derive(rows: Record<string, unknown>[]): DeriveOutput {
    const mapped = rows.map((r) => {
      const statusRaw = str(r.status).toLowerCase();
      const statusLabel = STATUS_LABELS[statusRaw] ?? str(r.status);

      // Use actual_date if the visit happened, otherwise scheduled_date
      const date = str(r.actual_date) || str(r.scheduled_date);

      // Site name: canonical stores site_id (UUID) but a denormalised
      // site_name is common in export rows. Fall back to site_id slice.
      const site = str(r.site_name) || str(r.site) || str(r.site_id).slice(0, 8);

      // Crew lead name: may be denormalised or may only have a UUID.
      const crewLead = str(r.crew_lead_name) || str(r.crew_lead) || str(r.crew_lead_id).slice(0, 8);

      return {
        'Date':               date,
        'Site':               site,
        'Client Job Code':    str(r.client_job_code) || str(r.job_code) || '',
        'Crew Lead':          crewLead,
        'Expected Assets':    str(r.expected_assets) || '',
        'Expected Circuits':  str(r.expected_circuits) || '',
        'Status':             statusLabel,
        'Logistics Notes':    str(r.logistics_notes) || str(r.notes) || '',
        // Sort keys
        _date:   date,
        _status: STATUS_SORT_ORDER[statusRaw] ?? 1,
        _site:   site.toLowerCase(),
      };
    });

    const sorted = [...mapped].sort((a, b) => {
      const d = (a._date as string).localeCompare(b._date as string);
      if (d !== 0) return d;
      const s = (a._status as number) - (b._status as number);
      if (s !== 0) return s;
      return (a._site as string).localeCompare(b._site as string);
    });

    const outRows = sorted.map(({ _date: _d, _status: _s, _site: _si, ...rest }) => rest);
    return { columns: COLUMNS, rows: outRows };
  },
};
