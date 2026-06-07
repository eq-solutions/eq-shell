#!/usr/bin/env node
// scripts/etl-nspbmir-to-ehow.mjs
//
// ETL: nspbmir (SKS standalone Field, WIDE public.*) → ehow (SKS canonical,
// NORMALIZED app_data.*). Moves the FULL SKS operational dataset — TEAMS, LEAVE,
// TIMESHEETS and SCHEDULE — keyed by tenant_id + staff_id, resolving people
// through the pre-built identity bridge (nspbmir public.people.canonical_id ==
// ehow app_data.staff.staff_id, also mirrored in ehow staff.external_id).
//
// This is cross-DB DATA movement, NOT a tenant DDL migration — it does NOT go
// through tenant-migrate.yml / supabase/tenant-migrations. It mirrors the
// existing one-off sync scripts (sync-tenant-data.mjs, sync-field-to-canonical.mjs).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ SAFETY — the write path is DOUBLE-GATED and OFF unless BOTH are present:  │
// │   1. the explicit `--apply` flag, AND                                     │
// │   2. real service-role env keys for BOTH planes                           │
// │      (NSPBMIR_SERVICE_KEY/URL + EHOW_SERVICE_KEY/URL — *_SUPABASE_* also   │
// │      accepted).                                                            │
// │ It NEVER writes in CI (process.env.CI). Absent either gate it falls back  │
// │ to DRY-RUN: it reads source + target and REPORTS what WOULD land, writing │
// │ nothing. Reads of nspbmir are READ-ONLY; writes (apply only) target ehow  │
// │ exclusively — a separate DB the live SKS standalone never reads.          │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Usage:
//   node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs                 # dry-run (default)
//   node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --surface=leave # one surface
//   node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --json          # machine-readable
//   node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --apply         # WRITE (gated; needs keys)
//
// Required env vars:
//   NSPBMIR_SERVICE_KEY / NSPBMIR_SUPABASE_SERVICE_KEY   source service-role (reads only)
//   NSPBMIR_URL         / NSPBMIR_SUPABASE_URL           source url (nspbmirochztcjijmcrx)
//   EHOW_SERVICE_KEY    / EHOW_SUPABASE_SERVICE_KEY      target service-role
//   EHOW_URL            / EHOW_SUPABASE_URL              target url (ehowgjardagevnrluult)
//   EHOW_TENANT_ID      ehow tenant_id rows land under (defaults below)
//
// Exit codes: 0 = report/apply ok; 1 = config error; 2 = read error;
//             3 = --apply requested but blocked (missing keys, or CI); 4 = write error.

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

import { buildResolver } from '../netlify/functions/_shared/etl/identity-bridge.ts';
import { transformTeam, transformTeamMember } from '../netlify/functions/_shared/etl/transform-teams.ts';
import { transformLeave } from '../netlify/functions/_shared/etl/transform-leave.ts';
import { transformTimesheet } from '../netlify/functions/_shared/etl/transform-timesheets.ts';
import { transformSchedule } from '../netlify/functions/_shared/etl/transform-schedule.ts';

// SKS org in nspbmir's WIDE schema — EXCLUDE demo org.
const SKS_ORG_ID  = '1eb831f9-aeae-4e57-b49e-9681e8f51e15';
const DEMO_ORG_ID = '2ec74247-43cd-4529-ac3e-d6c5aa4f9e2d';
// SKS canonical tenant (same mapping sync-field-to-canonical.mjs uses).
const DEFAULT_EHOW_TENANT_ID = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

// ── args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: true },
    apply:     { type: 'boolean', default: false },
    surface:   { type: 'string',  default: 'all' },   // all | teams | leave | timesheets | schedule
    json:      { type: 'boolean', default: false },
  },
});

const SURFACES = ['teams', 'leave', 'timesheets', 'schedule'];
const want = (s) => args.surface === 'all' || args.surface === s;
if (args.surface !== 'all' && !SURFACES.includes(args.surface)) {
  fail(1, `--surface must be all|${SURFACES.join('|')} (got '${args.surface}')`);
}

// ── env (accept both spellings) ─────────────────────────────────────────────

const NSPBMIR_URL = process.env.NSPBMIR_URL || process.env.NSPBMIR_SUPABASE_URL;
const NSPBMIR_KEY = process.env.NSPBMIR_SERVICE_KEY || process.env.NSPBMIR_SUPABASE_SERVICE_KEY;
const EHOW_URL    = process.env.EHOW_URL || process.env.EHOW_SUPABASE_URL;
const EHOW_KEY    = process.env.EHOW_SERVICE_KEY || process.env.EHOW_SUPABASE_SERVICE_KEY;
const TENANT_ID   = process.env.EHOW_TENANT_ID || DEFAULT_EHOW_TENANT_ID;

const haveAllKeys = !!(NSPBMIR_URL && NSPBMIR_KEY && EHOW_URL && EHOW_KEY);
const inCI = !!process.env.CI;

// ── DOUBLE GATE: decide apply vs dry-run ────────────────────────────────────
// Writes happen ONLY when the explicit --apply flag is set AND all four service
// keys are present AND we are not in CI. Anything short of that → dry-run.
let APPLY = false;
if (args.apply) {
  if (inCI) {
    fail(3, '--apply is refused in CI (process.env.CI is set). The write path never runs in CI.');
  }
  if (!haveAllKeys) {
    fail(3,
      '--apply requested but service keys are missing. Writes require ALL of ' +
      'NSPBMIR_SERVICE_KEY/URL + EHOW_SERVICE_KEY/URL. Falling back is not done for ' +
      '--apply — supply the keys or drop --apply to dry-run.');
  }
  APPLY = true;
}

// Dry-run still needs to READ both planes.
if (!haveAllKeys) {
  fail(1,
    'Missing env vars. Need NSPBMIR_SERVICE_KEY/URL + EHOW_SERVICE_KEY/URL ' +
    '(or the *_SUPABASE_* spellings). Reads are read-only; nothing is written in dry-run.');
}

const MODE = APPLY ? 'apply' : 'dry-run';

const source = createClient(NSPBMIR_URL, NSPBMIR_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(EHOW_URL, EHOW_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── load the identity bridge from ehow staff ───────────────────────────────

log('Loading identity bridge (ehow app_data.staff)…');
const staffRows = await readAll(
  target.schema('app_data').from('staff').select('staff_id, external_id, first_name, last_name').eq('tenant_id', TENANT_ID),
  'ehow staff',
);
// ehow staff has first_name + last_name, not a combined `name` column.
// Combine them so the identity bridge can match on display name (requester_name,
// name fields in nspbmir leave / timesheets / schedule).
const resolver = buildResolver(
  staffRows.map((s) => ({
    staff_id:    s.staff_id,
    external_id: s.external_id,
    name:        [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || null,
  })),
);
const bridgeStats = resolver.stats();

const report = {
  meta: {
    generated_at: new Date().toISOString(),
    mode: MODE,
    source: NSPBMIR_URL,
    target: EHOW_URL,
    ehow_tenant_id: TENANT_ID,
    sks_org_id: SKS_ORG_ID,
    excluded_demo_org_id: DEMO_ORG_ID,
    bridge_staff_count: bridgeStats.staffCount,
    bridge_ambiguous_names: bridgeStats.ambiguousNames,
  },
  surfaces: {},
};

// ── teams ───────────────────────────────────────────────────────────────

if (want('teams')) {
  const teams = await readAll(
    source.from('teams').select('id, org_id, name, color').eq('org_id', SKS_ORG_ID),
    'nspbmir teams',
  );
  const members = await readAll(
    source.from('team_members').select('team_id, person_id, org_id').eq('org_id', SKS_ORG_ID),
    'nspbmir team_members',
  );

  const validTeamIds = new Set(teams.map((t) => String(t.id)));
  const teamRows = teams.map((t) => transformTeam(t, TENANT_ID).row);

  const memberResults = members.map((m) => transformTeamMember(m, TENANT_ID, resolver, validTeamIds));
  const memberOk = memberResults.filter((r) => r.ok);
  const unmatchedPerson = memberResults.filter((r) => r.issues.includes('unmatched_person'));
  const orphanTeam = memberResults.filter((r) => r.issues.includes('orphan_team'));

  // Duplicate risk: two source members resolving to the same (team, staff).
  const seen = new Set();
  const dupMembers = [];
  const memberRows = [];
  for (const r of memberOk) {
    const k = `${r.row.team_id}::${r.row.staff_id}`;
    if (seen.has(k)) { dupMembers.push(r.source); continue; }
    seen.add(k);
    memberRows.push(r.row);
  }

  const teamUpsert = APPLY ? await upsert('teams', 'id', teamRows) : null;
  const memberUpsert = APPLY ? await upsert('team_members', 'id', memberRows) : null;

  report.surfaces.teams = {
    source_teams: teams.length,
    source_team_members: members.length,
    resolved_teams: teamRows.length,
    resolved_team_members: memberRows.length,
    [APPLY ? 'upserted_teams' : 'would_upsert_teams']: teamRows.length,
    [APPLY ? 'upserted_team_members' : 'would_upsert_team_members']: memberRows.length,
    unmatched_person: unmatchedPerson.map((r) => r.source),
    orphan_team_members: orphanTeam.map((r) => r.source),
    duplicate_member_pairs: dupMembers,
    ...(APPLY ? { applied: { teams: teamUpsert, team_members: memberUpsert } } : {}),
  };
}

// ── leave ───────────────────────────────────────────────────────────────

if (want('leave')) {
  const leave = await readAll(
    source
      .from('leave_requests')
      .select('id, requester_name, leave_type, date_start, date_end, note, approver_name, individual_days, status, archived')
      .eq('org_id', SKS_ORG_ID),
    'nspbmir leave_requests',
  );

  const results = leave.map((l) => transformLeave(l, TENANT_ID, resolver));
  const ok = results.filter((r) => r.ok);
  const rows = ok.map((r) => stampImported(r.row));

  const upserted = APPLY ? await upsert('leave_requests', 'leave_request_id', rows) : null;

  report.surfaces.leave = {
    source_leave_requests: leave.length,
    resolved: ok.length,
    blocked: results.length - ok.length,
    [APPLY ? 'upserted' : 'would_upsert']: rows.length,
    unmatched_requester: results.filter((r) => r.issues.includes('unmatched_requester')).map((r) => r.source),
    ambiguous_requester: results.filter((r) => r.issues.includes('ambiguous_requester')).map((r) => r.source),
    missing_dates: results.filter((r) => r.issues.includes('missing_dates')).map((r) => r.source),
    reversed_dates: results.filter((r) => r.issues.includes('to_date_before_from_date')).map((r) => r.source),
    needs_decision_individual_days: results.filter((r) => r.warnings.includes('lossy_individual_days')).map((r) => r.source),
    rdo_folded_to_other: results.filter((r) => r.warnings.includes('rdo_folded_to_other')).map((r) => r.source),
    unmatched_approver: results.filter((r) => r.warnings.includes('unmatched_approver')).map((r) => r.source),
    unmapped_leave_type: results.filter((r) => r.warnings.includes('unmapped_leave_type')).map((r) => r.source),
    ...(APPLY ? { applied: upserted } : {}),
  };
}

// ── timesheets ────────────────────────────────────────────────────────────

if (want('timesheets')) {
  const sheets = await readAll(
    source.from('timesheets').select('*').eq('org_id', SKS_ORG_ID),
    'nspbmir timesheets',
  );

  const results = sheets.map((t) => transformTimesheet(t, TENANT_ID, resolver));
  const ok = results.filter((r) => r.ok);
  const rows = ok.flatMap((r) => r.rows.map(stampImported));

  const upserted = APPLY ? await upsert('timesheets', 'timesheet_id', rows) : null;

  report.surfaces.timesheets = {
    source_rows: sheets.length,
    resolved_weeks: ok.length,
    blocked_weeks: results.length - ok.length,
    [APPLY ? 'upserted_rows' : 'would_upsert_rows']: rows.length,
    unmatched_staff: results.filter((r) => r.issues.includes('unmatched_staff')).map((r) => r.source),
    ambiguous_staff: results.filter((r) => r.issues.includes('ambiguous_staff')).map((r) => r.source),
    bad_week: results.filter((r) => r.issues.includes('bad_week')).map((r) => r.source),
    unmatched_approver: results.filter((r) => r.warnings.includes('unmatched_approver')).map((r) => r.source),
    site_id_unresolved: results.filter((r) => r.warnings.includes('site_id_unresolved')).length,
    ...(APPLY ? { applied: upserted } : {}),
  };
}

// ── schedule ──────────────────────────────────────────────────────────────
// EXCLUDES pending_schedule (the Tender-Pipeline labour-curve table — see
// roster-adapter.js header). Only the confirmed `schedule` surface is read.

if (want('schedule')) {
  const sched = await readAll(
    source.from('schedule').select('*').eq('org_id', SKS_ORG_ID),
    'nspbmir schedule',
  );

  const results = sched.map((s) => transformSchedule(s, TENANT_ID, resolver));
  const ok = results.filter((r) => r.ok);
  const rows = ok.flatMap((r) => r.rows.map(stampImported));

  // schedule_entries.site_id is NOT NULL live but we emit null → a real apply
  // would fail. Surface it as a blocker count; the apply UPSERT will report the
  // write error rather than silently dropping (gate documented in PR notes).
  const siteGap = results.filter((r) => r.warnings.includes('site_id_required_not_null')).length;

  const upserted = APPLY ? await upsert('schedule_entries', 'schedule_id', rows) : null;

  report.surfaces.schedule = {
    source_rows: sched.length,
    resolved_weeks: ok.length,
    blocked_weeks: results.length - ok.length,
    [APPLY ? 'upserted_rows' : 'would_upsert_rows']: rows.length,
    unmatched_staff: results.filter((r) => r.issues.includes('unmatched_staff')).map((r) => r.source),
    ambiguous_staff: results.filter((r) => r.issues.includes('ambiguous_staff')).map((r) => r.source),
    bad_week: results.filter((r) => r.issues.includes('bad_week')).map((r) => r.source),
    site_id_required_not_null: siteGap,
    ...(APPLY ? { applied: upserted } : {}),
  };
}

// ── output ────────────────────────────────────────────────────────────────

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}
process.exit(0);

// ══════════════════════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════════════════════

// Stamp imported_at at apply time (the pure transform leaves it null so the
// fixtures stay deterministic). Returns a shallow copy — never mutates the
// transform output.
function stampImported(row) {
  return APPLY ? { ...row, imported_at: report.meta.generated_at } : row;
}

// Idempotent UPSERT into ehow app_data.<table> on the deterministic PK. Same
// input → same PK → re-runs overwrite, never duplicate. Chunked to keep request
// bodies sane. ONLY called when APPLY is true.
async function upsert(table, conflictKey, rows) {
  if (!rows.length) return { read: 0, upserted: 0, chunks: 0 };
  const CHUNK = 500;
  let upserted = 0;
  let chunks = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await target
      .schema('app_data')
      .from(table)
      .upsert(slice, { onConflict: conflictKey, ignoreDuplicates: false });
    if (error) fail(4, `upsert ${table} chunk ${chunks} failed: ${error.message}`);
    upserted += slice.length;
    chunks += 1;
  }
  log(`upserted ${upserted} into app_data.${table} (${chunks} chunk(s))`);
  return { read: rows.length, upserted, chunks };
}

async function readAll(query, label) {
  const PAGE = 1000;
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) fail(2, `read ${label} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return out;
}

function printHuman(r) {
  const bar = '━'.repeat(72);
  const writing = r.meta.mode === 'apply';
  console.log(bar);
  console.log(writing
    ? ' nspbmir → ehow ETL — APPLY (writing ehow app_data)'
    : ' nspbmir → ehow ETL — DRY RUN (report only, no writes)');
  console.log(bar);
  console.log(`  mode           ${r.meta.mode}`);
  console.log(`  source         ${r.meta.source}`);
  console.log(`  target         ${r.meta.target}`);
  console.log(`  ehow tenant    ${r.meta.ehow_tenant_id}`);
  console.log(`  sks org        ${r.meta.sks_org_id}  (demo ${r.meta.excluded_demo_org_id} excluded)`);
  console.log(`  bridge staff   ${r.meta.bridge_staff_count}`);
  if (r.meta.bridge_ambiguous_names.length) {
    console.log(`  ! ambiguous names in bridge: ${r.meta.bridge_ambiguous_names.join(', ')}`);
  }

  const verb = writing ? 'upserted' : 'would upsert';

  if (r.surfaces.teams) {
    const t = r.surfaces.teams;
    console.log(bar);
    console.log(' TEAMS');
    console.log(`  source teams ............ ${t.source_teams}`);
    console.log(`  source team_members ..... ${t.source_team_members}`);
    console.log(`  ${verb} teams .......... ${t[writing ? 'upserted_teams' : 'would_upsert_teams']}`);
    console.log(`  ${verb} members ........ ${t[writing ? 'upserted_team_members' : 'would_upsert_team_members']}`);
    console.log(`  unmatched person ........ ${t.unmatched_person.length}`);
    console.log(`  orphan-team members ..... ${t.orphan_team_members.length}`);
    console.log(`  duplicate member pairs .. ${t.duplicate_member_pairs.length}`);
  }

  if (r.surfaces.leave) {
    const l = r.surfaces.leave;
    console.log(bar);
    console.log(' LEAVE');
    console.log(`  source leave requests ... ${l.source_leave_requests}`);
    console.log(`  ${verb} ................ ${l[writing ? 'upserted' : 'would_upsert']}`);
    console.log(`  blocked ................. ${l.blocked}`);
    console.log(`    unmatched requester ... ${l.unmatched_requester.length}`);
    console.log(`    ambiguous requester ... ${l.ambiguous_requester.length}`);
    console.log(`    missing dates ......... ${l.missing_dates.length}`);
    console.log(`    reversed dates ........ ${l.reversed_dates.length}`);
    console.log(`  ! needs decision (non-contiguous individual_days): ${l.needs_decision_individual_days.length}`);
    console.log(`  ! RDO folded to 'other' (schema gap): ${l.rdo_folded_to_other.length}`);
    console.log(`    unmatched approver .... ${l.unmatched_approver.length}`);
    console.log(`    unmapped leave_type ... ${l.unmapped_leave_type.length}`);
  }

  if (r.surfaces.timesheets) {
    const t = r.surfaces.timesheets;
    console.log(bar);
    console.log(' TIMESHEETS');
    console.log(`  source rows (weeks) ..... ${t.source_rows}`);
    console.log(`  resolved weeks .......... ${t.resolved_weeks}`);
    console.log(`  blocked weeks ........... ${t.blocked_weeks}`);
    console.log(`  ${verb} rows (days) .... ${t[writing ? 'upserted_rows' : 'would_upsert_rows']}`);
    console.log(`    unmatched staff ....... ${t.unmatched_staff.length}`);
    console.log(`    ambiguous staff ....... ${t.ambiguous_staff.length}`);
    console.log(`    bad week .............. ${t.bad_week.length}`);
    console.log(`    unmatched approver .... ${t.unmatched_approver.length}`);
    console.log(`  ! site_id unresolved (label kept in task): ${t.site_id_unresolved}`);
  }

  if (r.surfaces.schedule) {
    const s = r.surfaces.schedule;
    console.log(bar);
    console.log(' SCHEDULE');
    console.log(`  source rows (weeks) ..... ${s.source_rows}`);
    console.log(`  resolved weeks .......... ${s.resolved_weeks}`);
    console.log(`  blocked weeks ........... ${s.blocked_weeks}`);
    console.log(`  ${verb} rows (days) .... ${s[writing ? 'upserted_rows' : 'would_upsert_rows']}`);
    console.log(`    unmatched staff ....... ${s.unmatched_staff.length}`);
    console.log(`    ambiguous staff ....... ${s.ambiguous_staff.length}`);
    console.log(`    bad week .............. ${s.bad_week.length}`);
    console.log(`  ! site_id unresolved (label in task; nullable — does not block apply): ${s.site_id_required_not_null}`);
  }

  console.log(bar);
  if (writing) {
    console.log('  APPLY — rows UPSERTed into ehow app_data on deterministic keys.');
    console.log('  Re-runs overwrite the same rows (idempotent); nspbmir was read-only.');
  } else {
    console.log('  DRY RUN — nothing was written. Review blocked / needs-decision rows,');
    console.log('  then hand this report to Royce. Pass --apply WITH service keys to write.');
  }
  console.log(bar);
}

function log(msg) { if (!args.json) console.error(`[${new Date().toISOString()}] ${msg}`); }
function fail(code, msg) { console.error(`ERROR: ${msg}`); process.exit(code); }
