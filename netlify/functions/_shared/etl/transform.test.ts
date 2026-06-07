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
