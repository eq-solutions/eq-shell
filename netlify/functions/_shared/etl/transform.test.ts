// Golden-file unit tests for the nspbmir → ehow ETL transforms.
// Runs via `pnpm test` (node --test + tsx). Pure transforms, no DB — fixtures
// live in tests/fixtures/etl/. Covers the happy path plus the two cases the
// brief calls out explicitly: unmatched identities and the lossy
// individual_days (non-contiguous leave) case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildResolver, type StaffRow } from './identity-bridge.ts';
import {
  transformTeam,
  transformTeamMember,
  makeTeamUuid,
  type SourceTeam,
  type SourceTeamMember,
} from './transform-teams.ts';
import {
  transformLeave,
  toIsoDate,
  type SourceLeave,
} from './transform-leave.ts';
import {
  transformTimesheet,
  weekDayToDate as tsWeekDayToDate,
  parseDayJob,
  type SourceTimesheet,
} from './transform-timesheets.ts';
import {
  transformSchedule,
  classifyCell,
  leaveTypeForMarker,
  type SourceSchedule,
} from './transform-schedule.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(here, '../../../../tests/fixtures/etl');

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIX, name), 'utf8')) as T;
}

const staff = loadJson<StaffRow[]>('staff.json');
const resolver = buildResolver(staff);

// ── identity bridge ──────────────────────────────────────────────────────

test('resolver: byExternalId exact match', () => {
  assert.deepEqual(resolver.byExternalId(101), { staff_id: 'aaaaaaaa-0000-4000-8000-000000000001', via: 'external_id' });
  assert.equal(resolver.byExternalId(101).staff_id, resolver.byExternalId('101').staff_id, 'number and string person_id match');
});

test('resolver: byExternalId unmatched', () => {
  assert.deepEqual(resolver.byExternalId(999), { staff_id: null, via: 'unmatched' });
  assert.deepEqual(resolver.byExternalId(null), { staff_id: null, via: 'unmatched' });
});

test('resolver: byName is case/whitespace-insensitive', () => {
  assert.equal(resolver.byName('  jordan   reyes ').staff_id, 'aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(resolver.byName("Sam O'Neil").via, 'name');
  assert.equal(resolver.byName('Casey Lin').staff_id, 'aaaaaaaa-0000-4000-8000-000000000003', 'collapses double-space in source name');
});

test('resolver: ambiguous name resolves to null (never guesses)', () => {
  const r = resolver.byName('Pat Quinn');
  assert.equal(r.staff_id, null);
  assert.equal(r.via, 'ambiguous');
  assert.deepEqual(resolver.stats().ambiguousNames, ['pat quinn']);
});

// ── teams ────────────────────────────────────────────────────────────────

test('transformTeam: maps id→nspbmir_id, deterministic uuid, passes name/color', () => {
  const { tenant_id, teams } = loadJson<{ tenant_id: string; teams: SourceTeam[] }>('teams.source.json');
  const out = transformTeam(teams[0], tenant_id);
  assert.equal(out.ok, true);
  assert.equal(out.row.nspbmir_id, 1);
  assert.equal(out.row.tenant_id, tenant_id);
  assert.equal(out.row.name, 'Day Crew');
  assert.equal(out.row.color, '#3DA8D8');
  assert.match(out.row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // Deterministic: same input → same uuid.
  assert.equal(transformTeam(teams[0], tenant_id).row.id, out.row.id);
  // null color preserved.
  assert.equal(transformTeam(teams[1], tenant_id).row.color, null);
});

test('transformTeamMember: resolves person→staff, flags unmatched + orphan team', () => {
  const fx = loadJson<{ tenant_id: string; teams: SourceTeam[]; team_members: SourceTeamMember[] }>('teams.source.json');
  const validTeamIds = new Set(fx.teams.map((t) => String(t.id)));

  const ok = transformTeamMember(fx.team_members[0], fx.tenant_id, resolver, validTeamIds);
  assert.equal(ok.ok, true);
  assert.equal(ok.row!.staff_id, 'aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(ok.row!.team_id, makeTeamUuid(fx.tenant_id, 1));
  assert.deepEqual(ok.issues, []);

  // person_id 999 → unmatched
  const unmatched = transformTeamMember(fx.team_members[2], fx.tenant_id, resolver, validTeamIds);
  assert.equal(unmatched.ok, false);
  assert.equal(unmatched.row, null);
  assert.ok(unmatched.issues.includes('unmatched_person'));

  // team_id 7 (not in source teams) → orphan_team
  const orphan = transformTeamMember(fx.team_members[3], fx.tenant_id, resolver, validTeamIds);
  assert.equal(orphan.ok, false);
  assert.ok(orphan.issues.includes('orphan_team'));
});

// ── leave ────────────────────────────────────────────────────────────────

test('toIsoDate: ISO and DD/MM/YYYY, null on junk', () => {
  assert.equal(toIsoDate('2026-07-01'), '2026-07-01');
  assert.equal(toIsoDate('2026-07-01T09:00:00Z'), '2026-07-01');
  assert.equal(toIsoDate('12/08/2026'), '2026-08-12');
  assert.equal(toIsoDate('1/2/2026'), '2026-02-01');
  assert.equal(toIsoDate(''), null);
  assert.equal(toIsoDate('not a date'), null);
});

test('transformLeave: happy path maps every field + enums', () => {
  const { tenant_id, leave_requests } = loadJson<{ tenant_id: string; leave_requests: SourceLeave[] }>('leave.source.json');
  const out = transformLeave(leave_requests[0], tenant_id, resolver);
  assert.equal(out.ok, true);
  const row = out.row!;
  assert.equal(row.staff_id, 'aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(row.leave_type, 'annual', 'Annual Leave → annual');
  assert.equal(row.from_date, '2026-07-01');
  assert.equal(row.to_date, '2026-07-05');
  assert.equal(row.reason, 'Family holiday', 'note → reason');
  assert.equal(row.approver_id, 'aaaaaaaa-0000-4000-8000-000000000002', 'approver_name → approver_id');
  assert.equal(row.status, 'approved');
  assert.equal(row.imported_from, 'nspbmir');
  assert.equal(row.archived, false);
  assert.equal(out.needsDecision, false);
});

test('transformLeave: DD/MM dates + status synonym + null approver', () => {
  const { tenant_id, leave_requests } = loadJson<{ tenant_id: string; leave_requests: SourceLeave[] }>('leave.source.json');
  const out = transformLeave(leave_requests[1], tenant_id, resolver);
  assert.equal(out.ok, true);
  assert.equal(out.row!.from_date, '2026-08-12');
  assert.equal(out.row!.status, 'pending', 'Requested → pending');
  assert.equal(out.row!.leave_type, 'sick');
  assert.equal(out.row!.approver_id, null);
});

test('transformLeave: lossy individual_days keeps span, flags needsDecision, never drops', () => {
  const { tenant_id, leave_requests } = loadJson<{ tenant_id: string; leave_requests: SourceLeave[] }>('leave.source.json');
  const out = transformLeave(leave_requests[2], tenant_id, resolver);
  // Still produces a row (not dropped) — span derived from min..max of the days.
  assert.equal(out.ok, true);
  assert.equal(out.row!.from_date, '2026-09-02');
  assert.equal(out.row!.to_date, '2026-09-16');
  assert.ok(out.warnings.includes('lossy_individual_days'));
  assert.equal(out.needsDecision, true, 'non-contiguous leave needs a human decision');
});

test('transformLeave: unmatched requester blocks the insert', () => {
  const { tenant_id, leave_requests } = loadJson<{ tenant_id: string; leave_requests: SourceLeave[] }>('leave.source.json');
  const out = transformLeave(leave_requests[3], tenant_id, resolver);
  assert.equal(out.ok, false);
  assert.equal(out.row, null);
  assert.ok(out.issues.includes('unmatched_requester'));
});

test('transformLeave: ambiguous requester name is reported, not guessed', () => {
  const { tenant_id, leave_requests } = loadJson<{ tenant_id: string; leave_requests: SourceLeave[] }>('leave.source.json');
  const out = transformLeave(leave_requests[4], tenant_id, resolver);
  assert.equal(out.ok, false);
  assert.ok(out.issues.includes('ambiguous_requester'));
});

// RDO-in-LEAVE distinction: leave_requests has NO 'rdo' enum, so a leave row of
// type RDO must fold to 'other' AND carry the verbatim 'RDO' losslessly. (The
// schedule test below proves the SAME word maps to 'rdo' in schedule_entries.)
test('transformLeave: RDO folds to other + lossless carrier (leave_requests has no rdo)', () => {
  const { tenant_id, leave_requests } = loadJson<{ tenant_id: string; leave_requests: SourceLeave[] }>('leave.source.json');
  const out = transformLeave(leave_requests[5], tenant_id, resolver);
  assert.equal(out.ok, true);
  assert.equal(out.row!.leave_type, 'other', 'leave_requests enum has no rdo');
  assert.ok(out.warnings.includes('rdo_folded_to_other'));
  assert.equal(out.needsDecision, true);
  assert.match(out.row!.reason!, /\[leave_type: RDO\]/, 'verbatim RDO carried in reason');
  assert.match(out.row!.reason!, /Rostered day off/, 'original note preserved alongside carrier');
  // Withdrawn → cancelled (settled adapter status mapping).
  assert.equal(out.row!.status, 'cancelled', 'Withdrawn → cancelled');
});

test('transformLeave: reversed span (to_date < from_date) is blocked (CHECK)', () => {
  const { tenant_id, leave_requests } = loadJson<{ tenant_id: string; leave_requests: SourceLeave[] }>('leave.source.json');
  const out = transformLeave(leave_requests[6], tenant_id, resolver);
  assert.equal(out.ok, false);
  assert.equal(out.row, null);
  assert.ok(out.issues.includes('to_date_before_from_date'));
});

// ── timesheets ─────────────────────────────────────────────────────────────

test('parseDayJob: bare token uses day total; packed splits per segment', () => {
  assert.deepEqual(parseDayJob('D5384', 8), [{ label: 'D5384', hours: 8 }]);
  assert.deepEqual(parseDayJob('D5384:4|D5385:4', 8), [
    { label: 'D5384', hours: 4 },
    { label: 'D5385', hours: 4 },
  ]);
  assert.deepEqual(parseDayJob('', 0), []);
  assert.deepEqual(parseDayJob(null, null), []);
});

test('tsWeekDayToDate: Monday-anchored, matches Field week grammar', () => {
  assert.equal(tsWeekDayToDate('06.07.26', 0), '2026-07-06');
  assert.equal(tsWeekDayToDate('06.07.26', 4), '2026-07-10');
  assert.equal(tsWeekDayToDate('bad', 0), null);
});

test('transformTimesheet: explodes wide week → per-day/per-segment rows, approved→status', () => {
  const { tenant_id, timesheets } = loadJson<{ tenant_id: string; timesheets: SourceTimesheet[] }>('timesheets.source.json');
  const out = transformTimesheet(timesheets[0], tenant_id, resolver);
  assert.equal(out.ok, true);
  // mon (1 seg) + tue (2 segs) + fri (1 seg) = 4 rows; empty days skipped.
  assert.equal(out.rows.length, 4);
  const mon = out.rows.find((r) => r.date === '2026-07-06')!;
  assert.equal(mon.task, 'D5384');
  assert.equal(mon.hours, 8);
  assert.equal(mon.status, 'approved', 'approved bool → approved status');
  assert.equal(mon.staff_id, 'aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(mon.site_id, null, 'no resolver — label kept in task');
  assert.equal(mon.shift, null);
  // tue packed → two rows, hours 4 + 4
  const tue = out.rows.filter((r) => r.date === '2026-07-07');
  assert.equal(tue.length, 2);
  assert.deepEqual(tue.map((r) => r.hours).sort(), [4, 4]);
  // approver resolved
  assert.equal(mon.approved_by_user_id, 'aaaaaaaa-0000-4000-8000-000000000002');
  assert.ok(out.warnings.includes('site_id_unresolved'));
  // Deterministic ids: re-run yields identical PKs.
  const again = transformTimesheet(timesheets[0], tenant_id, resolver);
  assert.deepEqual(again.rows.map((r) => r.timesheet_id), out.rows.map((r) => r.timesheet_id));
});

test('transformTimesheet: un-approved week → submitted status', () => {
  const { tenant_id, timesheets } = loadJson<{ tenant_id: string; timesheets: SourceTimesheet[] }>('timesheets.source.json');
  const out = transformTimesheet(timesheets[1], tenant_id, resolver);
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].status, 'submitted', 'not approved → submitted');
});

test('transformTimesheet: unmatched staff blocks the whole week', () => {
  const { tenant_id, timesheets } = loadJson<{ tenant_id: string; timesheets: SourceTimesheet[] }>('timesheets.source.json');
  const out = transformTimesheet(timesheets[2], tenant_id, resolver);
  assert.equal(out.ok, false);
  assert.equal(out.rows.length, 0);
  assert.ok(out.issues.includes('unmatched_staff'));
});

// ── schedule ───────────────────────────────────────────────────────────────

test('leaveTypeForMarker: schedule_entries enum incl. rdo (DIFFERS from leave)', () => {
  assert.equal(leaveTypeForMarker('RDO'), 'rdo', 'schedule_entries HAS rdo');
  assert.equal(leaveTypeForMarker('A/L'), 'annual');
  assert.equal(leaveTypeForMarker('U/L'), 'unpaid');
  assert.equal(leaveTypeForMarker('SICK'), 'sick');
  assert.equal(leaveTypeForMarker('PH'), 'public_holiday');
  assert.equal(leaveTypeForMarker('TAFE'), 'tafe');
  assert.equal(leaveTypeForMarker('JURY'), 'other', 'unknown leave-ish → other');
});

test('classifyCell: OFF→cancelled, blank→no row, site code→planned, education before leave', () => {
  assert.equal(classifyCell(''), null, 'blank → no row');
  assert.equal(classifyCell(null), null);
  const off = classifyCell('OFF')!;
  assert.equal(off.status, 'cancelled');
  assert.equal(off.task, 'OFF');
  assert.equal(off.leave_type, null);
  const tafe = classifyCell('TAFE')!;
  assert.equal(tafe.status, 'planned');
  assert.equal(tafe.leave_type, 'tafe', 'education → tafe, not a leave bucket');
  const site = classifyCell('D5384', '5384')!;
  assert.equal(site.status, 'planned');
  assert.equal(site.task, 'D5384');
  assert.equal(site.leave_type, null);
  assert.equal(site.notes, 'job:5384', 'per-day job pin → notes');
  assert.equal(site.isSiteCode, true);
});

test('transformSchedule: RDO cell → leave_type rdo (per-table split vs leave_requests)', () => {
  const { tenant_id, schedule } = loadJson<{ tenant_id: string; schedule: SourceSchedule[] }>('schedule.source.json');
  const out = transformSchedule(schedule[0], tenant_id, resolver);
  assert.equal(out.ok, true);
  // mon (site) + tue (RDO) + wed (A/L) + thu (TAFE) + fri (OFF) = 5 rows.
  assert.equal(out.rows.length, 5);
  const tue = out.rows.find((r) => r.date === '2026-07-07')!;
  assert.equal(tue.leave_type, 'rdo', 'schedule_entries RDO → rdo (NOT other)');
  assert.equal(tue.task, 'RDO', 'verbatim marker carried in task');
  assert.equal(tue.status, 'planned');
  const fri = out.rows.find((r) => r.date === '2026-07-10')!;
  assert.equal(fri.status, 'cancelled', 'OFF → cancelled');
  assert.equal(fri.task, 'OFF');
  const mon = out.rows.find((r) => r.date === '2026-07-06')!;
  assert.equal(mon.site_id, null);
  assert.equal(mon.hours_planned, 0, 'no planned-hours source — 0 placeholder');
  assert.equal(mon.notes, 'job:5384');
  assert.ok(out.warnings.includes('site_id_required_not_null'), 'NOT NULL schema gap flagged');
  // Deterministic ids.
  const again = transformSchedule(schedule[0], tenant_id, resolver);
  assert.deepEqual(again.rows.map((r) => r.schedule_id), out.rows.map((r) => r.schedule_id));
});

test('transformSchedule: unmatched staff blocks the whole week', () => {
  const { tenant_id, schedule } = loadJson<{ tenant_id: string; schedule: SourceSchedule[] }>('schedule.source.json');
  const out = transformSchedule(schedule[2], tenant_id, resolver);
  assert.equal(out.ok, false);
  assert.equal(out.rows.length, 0);
  assert.ok(out.issues.includes('unmatched_staff'));
});
