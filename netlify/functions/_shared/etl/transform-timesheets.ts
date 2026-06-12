// Pure transform: nspbmir WIDE timesheets → ehow app_data.timesheets.
// No DB driver, no I/O. Takes one WIDE source row (one row per person per WEEK)
// + an injected identity resolver, and EXPLODES it into the set of normalized
// rows (one row per person per DAY per job SEGMENT) plus per-row diagnostics for
// the dry-run report.
//
// This mirrors eq-solves-field scripts/timesheets-adapter.js toNormalizedRows()
// — the settled wide→normalized mapping the Field canonical adapter reads back —
// so a wide → ETL → ehow → adapter → wide round-trip is consistent. Where the
// adapter delegates name→staff_id to a browser-loaded staff map, here we use the
// injected nspbmir→ehow identity resolver (byName, the source is name-keyed).
//
// Source (nspbmir, WIDE — one row / person / week):
//   { name text, week text "DD.MM.YY" (the Monday),
//     <day>_job text  ("JOB" | "JOB:h|JOB:h" packed segments),
//     <day>_hrs numeric (day total),
//     approved bool, approved_by text (name), approved_at text, notes text }
//   where <day> ∈ mon,tue,wed,thu,fri,sat,sun.
//
// Target (ehow, NORMALIZED app_data.timesheets) — shape from @eq/schemas
// timesheet.types.ts:
//   { timesheet_id uuid, tenant_id, staff_id, site_id?, schedule_id?, date,
//     start_time?, end_time?, hours, break_minutes?, shift?, task?, status,
//     submitted_at?, approved_at?, approved_by_user_id?, paid_at?, notes?,
//     imported_at?, imported_from? }
//
// LIVE-VERIFIED ehow enums (per-table):
//   status ∈ {draft, submitted, approved, rejected, paid} ; hours >= 0 ;
//   shift  ∈ {day, night, split, arvo} (left NULL — Field timesheets carry none).
//
// Mapping (mirrors timesheets-adapter.js):
//   name           → staff_id   (via resolver.byName)
//   week + dayIdx  → date        ("DD.MM.YY" Monday + offset)
//   <day>_job      → task        (the JOB/SITE label, kept verbatim per segment)
//   <day>_hrs      → hours        (per segment; single-token day → day total)
//   approved bool  → status       (true → 'approved'; else → 'submitted'.
//                                  A wholly empty/unentered week emits no rows,
//                                  so 'draft' is reachable only via an explicit
//                                  draft flag — see statusFor()).
//   approved_by    → approved_by_user_id  (via resolver.byName; optional)
//   approved_at    → approved_at
//   notes          → notes (shared across the week's exploded rows)
//   site_id        → NULL  (no label→site_id resolver wired — label kept in task)

import { makeUuid } from './transform-teams.ts';
import type { IdentityResolver } from './identity-bridge.ts';

const IMPORTED_FROM = 'nspbmir';
const TS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export interface SourceTimesheet {
  id: number | string;
  name: string | null;
  week: string | null;            // "DD.MM.YY" Monday key
  approved: boolean | null;
  approved_by: string | null;     // name
  approved_at: string | null;
  notes: string | null;
  // Per-day packed job + day-total hours. Indexed dynamically below.
  [key: string]: unknown;
}

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
export type TimesheetShift = 'day' | 'night' | 'split' | 'arvo';

export interface TargetTimesheet {
  timesheet_id: string;
  tenant_id: string;
  staff_id: string;
  site_id: string | null;
  date: string;                   // ISO (YYYY-MM-DD)
  hours: number;                  // >= 0
  shift: TimesheetShift | null;
  task: string | null;            // the JOB/SITE label (verbatim)
  status: TimesheetStatus;
  approved_at?: string | null;
  approved_by_user_id?: string | null;
  notes?: string | null;
  imported_at?: string | null;
  imported_from?: string | null;
}

export interface TimesheetResult {
  ok: boolean;
  rows: TargetTimesheet[];        // exploded per-day/per-segment rows (may be many)
  warnings: string[];             // 'site_id_unresolved', 'unmatched_approver', ...
  issues: string[];               // 'unmatched_staff', 'bad_week'
  source: { id: string; name: string | null; week: string | null };
}

// "DD.MM.YY" + dayOffset(0..6) → "YYYY-MM-DD". Exact inverse of the adapter's
// weekDayToDate (Monday-anchored), so dates line up byte-for-byte with Field.
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

// Parse a <day>_job packed string + day-total into [{ label, hours }]. Mirrors
// timesheets-adapter.js parseDayJob:
//   ""/null        → []
//   "D5384"        → [{ D5384, <dayHrs> }]                (single bare token)
//   "D5384:4|D6:4" → [{ D5384, 4 }, { D6, 4 }]            (packed segments)
export function parseDayJob(jobStr: unknown, dayHrs: unknown): Array<{ label: string; hours: number }> {
  const raw = jobStr == null ? '' : String(jobStr).trim();
  if (!raw) return [];
  if (raw.indexOf('|') === -1 && raw.indexOf(':') === -1) {
    const h = dayHrs == null || dayHrs === '' ? 0 : parseFloat(String(dayHrs)) || 0;
    return [{ label: raw, hours: h }];
  }
  return raw
    .split('|')
    .map((seg) => {
      const s = String(seg).trim();
      if (!s) return null;
      const ci = s.lastIndexOf(':');
      if (ci === -1) return { label: s, hours: 0 };
      const label = s.slice(0, ci).trim();
      const hours = parseFloat(s.slice(ci + 1)) || 0;
      return { label, hours };
    })
    .filter((x): x is { label: string; hours: number } => x != null);
}

// approved bool → status. Mirrors the adapter (approved ? 'approved' :
// 'submitted'). An optional explicit `draft` flag on the source row downgrades
// an un-approved week to 'draft' so the full enum is reachable; nspbmir has no
// such column today, so in practice this resolves to 'approved' | 'submitted'.
function statusFor(src: SourceTimesheet): TimesheetStatus {
  if (src.approved) return 'approved';
  if (src.draft === true) return 'draft';
  return 'submitted';
}

export function transformTimesheet(
  src: SourceTimesheet,
  tenantId: string,
  resolver: IdentityResolver,
): TimesheetResult {
  const warnings: string[] = [];
  const issues: string[] = [];
  const source = { id: String(src.id), name: src.name, week: src.week ?? null };

  const staff = resolver.byName(src.name);
  if (!staff.staff_id) {
    issues.push(staff.via === 'ambiguous' ? 'ambiguous_staff' : 'unmatched_staff');
  } else if (resolver.isArchived(staff.staff_id)) {
    warnings.push('archived_staff');
  }
  if (!src.week || String(src.week).split('.').length !== 3) {
    issues.push('bad_week');
  }

  const status = statusFor(src);
  const approvedAt = src.approved ? src.approved_at ?? null : null;
  let approverId: string | null = null;
  if (src.approved && src.approved_by && src.approved_by.trim()) {
    const ap = resolver.byName(src.approved_by);
    if (ap.staff_id) approverId = ap.staff_id;
    else warnings.push('unmatched_approver');
  }
  const sharedNotes = src.notes ?? null;

  if (issues.length > 0) {
    return { ok: false, rows: [], warnings, issues, source };
  }

  const rows: TargetTimesheet[] = [];
  let sawSiteLabel = false;
  TS_DAYS.forEach((day, idx) => {
    const segs = parseDayJob(src[`${day}_job`], src[`${day}_hrs`]);
    if (segs.length === 0) return;                         // empty day — skip
    const date = weekDayToDate(src.week, idx);
    if (!date) {
      warnings.push(`undatable_day_${day}`);
      return;
    }
    segs.forEach((seg, segIdx) => {
      const hours = Number(seg.hours) || 0;                // hours >= 0 (NaN → 0)
      if (seg.label) sawSiteLabel = true;
      rows.push({
        // Deterministic uuid keyed on the staff×date×segment so a dry-run and an
        // apply agree, and a re-run UPSERTs the same row (no duplicate).
        timesheet_id: makeUuid('timesheet', tenantId, staff.staff_id!, date, String(segIdx)),
        tenant_id: tenantId,
        staff_id: staff.staff_id!,
        site_id: null,                                     // no resolver — label in task
        date,
        hours: hours < 0 ? 0 : hours,
        shift: null,
        task: seg.label || null,
        status,
        approved_at: approvedAt,
        approved_by_user_id: approverId,
        notes: sharedNotes,
        imported_at: null,                                 // stamped at apply time
        imported_from: IMPORTED_FROM,
      });
    });
  });

  if (sawSiteLabel) warnings.push('site_id_unresolved');

  return { ok: true, rows, warnings, issues, source };
}
