// Pure transform: nspbmir WIDE schedule → ehow app_data.schedule_entries.
// No DB driver, no I/O. Takes one WIDE source row (one row per person per WEEK)
// + an injected identity resolver, and EXPLODES it into the set of normalized
// rows (one row per person per DAY) plus per-row diagnostics for the dry-run
// report.
//
// This mirrors eq-solves-field scripts/roster-adapter.js classifyCell() +
// toNormalizedRows() — the settled wide→normalized cell grammar the Field
// canonical adapter reads back — so a wide → ETL → ehow → adapter → wide
// round-trip is consistent. Where the adapter delegates name→staff_id to a
// browser-loaded staff map, here we use the injected nspbmir→ehow identity
// resolver (byName; the source is name-keyed).
//
// Source (nspbmir, WIDE — one row / person / week, table `schedule`):
//   { name text, week text "DD.MM.YY" (the Monday),
//     mon..sun text  (ONE cell each: a site code, a leave marker "A/L"/"RDO"/…,
//                     an education marker "TAFE", "OFF", or blank),
//     <day>_job text (optional per-day pinned job number) }
//   pending_schedule is the Tender-Pipeline labour-curve table — NOT this surface
//   — and is EXCLUDED (the runner never reads it). See roster-adapter.js header.
//
// Target (ehow, NORMALIZED app_data.schedule_entries) — LIVE DDL
// (supabase/tenant-migrations/0002_remaining_tables.sql):
//   { schedule_id uuid PK, tenant_id, staff_id, site_id uuid NOT NULL,
//     date NOT NULL, hours_planned numeric NOT NULL, shift?, task?, status?,
//     leave_type?, notes?, imported_at?, imported_from?, ... }
//
// LIVE-VERIFIED ehow enums (per-table — DIFFER from leave_requests):
//   status     ∈ {planned, confirmed, in_progress, completed, cancelled, no_show}
//   leave_type ∈ {annual, sick, personal, rdo, tafe, unpaid, public_holiday, other}
//   shift      ∈ {day, evening, night, weekend, afterhours}  (left NULL here)
//
// Cell grammar (mirrors roster-adapter.js classifyCell):
//   ""/null/blank → (no row — empty day skipped)
//   "OFF"         → status='cancelled', task='OFF', leave_type=null
//   education     → status='planned',  leave_type='tafe', task=verbatim marker
//   leave marker  → status='planned',  leave_type=<enum bucket>, task=verbatim
//                   (RDO → 'rdo' — this table HAS 'rdo', unlike leave_requests)
//   site code     → status='planned',  task=verbatim label, leave_type=null
//   <day>_job pin → notes "job:<n>" (lossless)
//
// NOTE: the LIVE table has `site_id uuid NULL` (nullable — verified 2026-06-08)
//   and `hours_planned numeric NOT NULL`. The Field roster surface has NO site_id
//   resolver (no sites table seeded for SKS tenant yet), so the label is kept in
//   `task` and site_id is emitted as null. hours_planned = 0 as a placeholder.
//   Both land cleanly; site_id_required_not_null warnings are informational only
//   (not apply-blockers). Site resolution can be added once sites are seeded.

import { makeUuid } from './transform-teams.ts';
import type { IdentityResolver } from './identity-bridge.ts';

const IMPORTED_FROM = 'nspbmir';
const RS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const STATUS_PLANNED = 'planned';
const STATUS_CANCELLED = 'cancelled';

export type ScheduleStatus =
  | 'planned' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
export type ScheduleLeaveType =
  | 'annual' | 'sick' | 'personal' | 'rdo' | 'tafe' | 'unpaid' | 'public_holiday' | 'other';

export interface SourceSchedule {
  id: number | string;
  name: string | null;
  week: string | null;            // "DD.MM.YY" Monday key
  [key: string]: unknown;         // mon..sun cells + <day>_job pins
}

export interface TargetScheduleEntry {
  schedule_id: string;
  tenant_id: string;
  staff_id: string;
  site_id: string | null;         // LIVE table is NOT NULL — see schema-gap flag
  date: string;                   // ISO (YYYY-MM-DD)
  hours_planned: number;          // LIVE table is NOT NULL — 0 placeholder
  shift: string | null;
  task: string | null;            // verbatim cell (lossless carrier)
  status: ScheduleStatus;
  leave_type: ScheduleLeaveType | null;
  notes: string | null;
  imported_at?: string | null;
  imported_from?: string | null;
}

export interface ScheduleResult {
  ok: boolean;
  rows: TargetScheduleEntry[];
  warnings: string[];             // 'site_id_required_not_null', ...
  issues: string[];               // 'unmatched_staff', 'bad_week'
  source: { id: string; name: string | null; week: string | null };
}

// "DD.MM.YY" + dayOffset(0..6) → "YYYY-MM-DD". Identical to the timesheets +
// roster week grammar so dates line up byte-for-byte with Field.
export function weekDayToDate(week: string | null | undefined, dayOffset: number): string | null {
  const parts = String(week ?? '').split('.');
  if (parts.length !== 3) return null;
  const [dd, mm, yy] = parts;
  const mon = new Date(`20${yy}-${mm}-${dd}T00:00:00`);
  if (isNaN(mon.getTime())) return null;
  mon.setDate(mon.getDate() + (dayOffset | 0));
  const y = mon.getFullYear();
  const m = String(mon.getMonth() + 1).padStart(2, '0');
  const d = String(mon.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Marker (upper-cased, trimmed) → schedule_entries.leave_type enum. Mirrors
// roster-adapter.js _leaveTypeForMarker EXACTLY (longest/most-specific first).
// This table HAS 'rdo' — so RDO → 'rdo' (unlike leave_requests, where RDO folds
// to 'other'). That per-table split is the #1 mistake source the brief calls out.
export function leaveTypeForMarker(marker: string | null | undefined): ScheduleLeaveType {
  const u = String(marker ?? '').toUpperCase().trim();
  if (!u) return 'other';
  if (u.indexOf('TAFE') === 0 || u.indexOf('TRAINING') === 0 ||
      u.indexOf('TRADE SCHOOL') === 0 || u.indexOf('COLLEGE') === 0 ||
      u.indexOf('SCHOOL') === 0 || u.indexOf('COURSE') === 0) return 'tafe';
  if (u === 'SICK' || u === 'SCK' || u.indexOf('SICK') === 0) return 'sick';
  if (u === 'RDO' || u.indexOf('RDO') === 0) return 'rdo';
  if (u === 'PH' || u.indexOf('PUBLIC HOL') === 0 || u.indexOf('PH') === 0) return 'public_holiday';
  if (u === 'U/L' || u === 'UL' || u.indexOf('LWOP') === 0 || u.indexOf('UNPAID') === 0) return 'unpaid';
  if (u.indexOf('CARER') === 0 || u.indexOf('PERSONAL') === 0) return 'personal';
  if (u === 'A/L' || u === 'AL' || u.indexOf('ANN') === 0 || u === 'LVE' ||
      u === 'LEAVE' || u.indexOf('ANNUAL') === 0) return 'annual';
  return 'other';
}

// roster-adapter.js cell classifiers (self-contained copies of the same term
// lists used by roster.js isLeave()/isEducation()).
const LEAVE_TERMS = ['A/L', 'U/L', 'RDO', 'PH', 'SICK', 'SCK', 'ANN', 'LWOP', 'LSL', 'JURY', 'WC', 'CARER', 'BEREAVEMENT', 'PARENTAL', 'LEAVE'];
const EDUCATION_TERMS = ['TAFE', 'TRAINING', 'TRADE SCHOOL', 'COLLEGE', 'SCHOOL', 'COURSE'];

function isLeaveCell(code: string): boolean {
  const u = code.toUpperCase().trim();
  if (!u) return false;
  return LEAVE_TERMS.some((t) => u === t || u.indexOf(t) === 0);
}
function isEducationCell(code: string): boolean {
  const u = code.toUpperCase().trim();
  if (!u) return false;
  return EDUCATION_TERMS.some((t) => u === t || u.indexOf(t) === 0);
}
function isOffCell(code: string): boolean {
  return code.toUpperCase().trim() === 'OFF';
}

function jobNote(jobPin: unknown): string | null {
  const p = jobPin == null ? '' : String(jobPin).trim();
  return p ? `job:${p}` : null;
}

interface CellFragment {
  status: ScheduleStatus;
  task: string;
  leave_type: ScheduleLeaveType | null;
  notes: string | null;
  isSiteCode: boolean;            // true when a real site/job label (site_id gap applies)
}

// Classify one cell's TEXT value (+ optional job pin) into a normalized fragment,
// or null for an empty cell (no row). Education before leave; OFF before leave —
// exactly the order roster-adapter.js uses.
export function classifyCell(code: unknown, jobPin?: unknown): CellFragment | null {
  const raw = code == null ? '' : String(code).trim();
  if (!raw) return null;                                   // empty day — no row
  if (isOffCell(raw)) {
    return { status: STATUS_CANCELLED, task: raw, leave_type: null, notes: null, isSiteCode: false };
  }
  if (isEducationCell(raw)) {
    return { status: STATUS_PLANNED, task: raw, leave_type: 'tafe', notes: jobNote(jobPin), isSiteCode: false };
  }
  if (isLeaveCell(raw)) {
    return { status: STATUS_PLANNED, task: raw, leave_type: leaveTypeForMarker(raw), notes: null, isSiteCode: false };
  }
  return { status: STATUS_PLANNED, task: raw, leave_type: null, notes: jobNote(jobPin), isSiteCode: true };
}

export function transformSchedule(
  src: SourceSchedule,
  tenantId: string,
  resolver: IdentityResolver,
): ScheduleResult {
  const warnings: string[] = [];
  const issues: string[] = [];
  const source = { id: String(src.id), name: src.name, week: src.week ?? null };

  const staff = resolver.byName(src.name);
  if (!staff.staff_id) {
    issues.push(staff.via === 'ambiguous' ? 'ambiguous_staff' : 'unmatched_staff');
  }
  if (!src.week || String(src.week).split('.').length !== 3) {
    issues.push('bad_week');
  }

  if (issues.length > 0) {
    return { ok: false, rows: [], warnings, issues, source };
  }

  const rows: TargetScheduleEntry[] = [];
  let sawSiteCode = false;
  RS_DAYS.forEach((day, idx) => {
    const frag = classifyCell(src[day], src[`${day}_job`]);
    if (!frag) return;                                     // empty day — skip
    const date = weekDayToDate(src.week, idx);
    if (!date) {
      warnings.push(`undatable_day_${day}`);
      return;
    }
    if (frag.isSiteCode) sawSiteCode = true;
    rows.push({
      // Deterministic uuid keyed on staff×date (schedule_entries is one row per
      // person per day) so dry-run and apply agree and re-runs UPSERT, no dupes.
      schedule_id: makeUuid('schedule_entry', tenantId, staff.staff_id!, date),
      tenant_id: tenantId,
      staff_id: staff.staff_id!,
      site_id: null,                                       // LIVE NOT NULL — see flag
      date,
      hours_planned: 0,                                    // LIVE NOT NULL — placeholder
      shift: null,
      task: frag.task,
      status: frag.status,
      leave_type: frag.leave_type,
      notes: frag.notes,
      imported_at: null,                                   // stamped at apply time
      imported_from: IMPORTED_FROM,
    });
  });

  // The LIVE table requires site_id NOT NULL but the roster surface has no
  // site_id resolver. Flag whenever any row carries a real site/job label —
  // the apply path must resolve site_id (or relax the constraint) before writing.
  if (sawSiteCode) warnings.push('site_id_required_not_null');

  return { ok: true, rows, warnings, issues, source };
}
