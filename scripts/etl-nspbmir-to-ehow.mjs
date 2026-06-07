#!/usr/bin/env node
// scripts/etl-nspbmir-to-ehow.mjs
//
// DRY-RUN / report-only ETL: nspbmir (SKS standalone Field, WIDE public.*) →
// ehow (SKS canonical, NORMALIZED app_data.*). Moves two surfaces — TEAMS and
// LEAVE — keyed by tenant_id + staff_id, resolving people through the pre-built
// identity bridge (nspbmir public.people.canonical_id == ehow staff.staff_id,
// also mirrored in ehow staff.external_id).
//
// This is cross-DB DATA movement, NOT a tenant DDL migration — it does NOT go
// through tenant-migrate.yml / supabase/tenant-migrations. It mirrors the
// existing one-off sync scripts (sync-tenant-data.mjs, sync-field-to-canonical.mjs).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ SAFETY: defaults to --dry-run. Reads source + target and REPORTS what     │
// │ WOULD land. It NEVER writes in this branch. The --apply path is a gated   │
// │ no-op stub (see applyStub) and exits non-zero — Royce wires the real      │
// │ writer + runs it later, after reviewing the dry-run.                      │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Usage:
//   node scripts/etl-nspbmir-to-ehow.mjs                 # dry-run (default)
//   node scripts/etl-nspbmir-to-ehow.mjs --surface=leave # one surface only
//   node scripts/etl-nspbmir-to-ehow.mjs --json          # machine-readable report
//
// Required env vars (READ-ONLY service keys; this script never writes):
//   NSPBMIR_SUPABASE_URL          source SKS standalone (nspbmirochztcjijmcrx)
//   NSPBMIR_SUPABASE_SERVICE_KEY  source service-role (reads only)
//   EHOW_SUPABASE_URL             target SKS canonical (ehowgjardagevnrluult)
//   EHOW_SUPABASE_SERVICE_KEY     target service-role (reads only in dry-run)
//   EHOW_TENANT_ID                ehow tenant_id the rows land under
//                                 (defaults to the SKS canonical tenant below)
//
// Exit codes: 0 = report produced; 1 = config error; 2 = read error;
//             3 = --apply attempted (blocked in this branch).

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

import { buildResolver } from '../netlify/functions/_shared/etl/identity-bridge.ts';
import { transformTeam, transformTeamMember } from '../netlify/functions/_shared/etl/transform-teams.ts';
import { transformLeave } from '../netlify/functions/_shared/etl/transform-leave.ts';

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
    surface:   { type: 'string',  default: 'all' },   // all | teams | leave
    json:      { type: 'boolean', default: false },
  },
});

const wantTeams = args.surface === 'all' || args.surface === 'teams';
const wantLeave = args.surface === 'all' || args.surface === 'leave';
if (!wantTeams && !wantLeave) fail(1, `--surface must be all|teams|leave (got '${args.surface}')`);

// HARD GATE: --apply is intentionally not implemented on this branch.
if (args.apply) applyStub();

const env = requireEnvs([
  'NSPBMIR_SUPABASE_URL', 'NSPBMIR_SUPABASE_SERVICE_KEY',
  'EHOW_SUPABASE_URL', 'EHOW_SUPABASE_SERVICE_KEY',
]);
const TENANT_ID = process.env.EHOW_TENANT_ID || DEFAULT_EHOW_TENANT_ID;

const source = createClient(env.NSPBMIR_SUPABASE_URL, env.NSPBMIR_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(env.EHOW_SUPABASE_URL, env.EHOW_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── load the identity bridge from ehow staff ───────────────────────────────

log('Loading identity bridge (ehow app_data.staff)…');
const staffRows = await readAll(
  target.schema('app_data').from('staff').select('staff_id, external_id, name').eq('tenant_id', TENANT_ID),
  'ehow staff',
);
const resolver = buildResolver(
  staffRows.map((s) => ({ staff_id: s.staff_id, external_id: s.external_id, name: s.name })),
);
const bridgeStats = resolver.stats();

const report = {
  meta: {
    generated_at: new Date().toISOString(),
    mode: 'dry-run',
    source: env.NSPBMIR_SUPABASE_URL,
    target: env.EHOW_SUPABASE_URL,
    ehow_tenant_id: TENANT_ID,
    sks_org_id: SKS_ORG_ID,
    excluded_demo_org_id: DEMO_ORG_ID,
    bridge_staff_count: bridgeStats.staffCount,
    bridge_ambiguous_names: bridgeStats.ambiguousNames,
  },
  surfaces: {},
};

// ── teams ───────────────────────────────────────────────────────────────

if (wantTeams) {
  const teams = await readAll(
    source.from('teams').select('id, org_id, name, color').eq('org_id', SKS_ORG_ID),
    'nspbmir teams',
  );
  const members = await readAll(
    source.from('team_members').select('team_id, person_id, org_id').eq('org_id', SKS_ORG_ID),
    'nspbmir team_members',
  );

  const validTeamIds = new Set(teams.map((t) => String(t.id)));
  const wouldInsertTeams = teams.map((t) => transformTeam(t, TENANT_ID).row);

  const memberResults = members.map((m) => transformTeamMember(m, TENANT_ID, resolver, validTeamIds));
  const memberOk = memberResults.filter((r) => r.ok);
  const unmatchedPerson = memberResults.filter((r) => r.issues.includes('unmatched_person'));
  const orphanTeam = memberResults.filter((r) => r.issues.includes('orphan_team'));

  // Duplicate risk: two source members resolving to the same (team, staff).
  const seen = new Set();
  const dupMembers = [];
  for (const r of memberOk) {
    const k = `${r.row.team_id}::${r.row.staff_id}`;
    if (seen.has(k)) dupMembers.push(r.source);
    else seen.add(k);
  }

  report.surfaces.teams = {
    source_teams: teams.length,
    source_team_members: members.length,
    would_insert_teams: wouldInsertTeams.length,
    would_insert_team_members: memberOk.length,
    unmatched_person: unmatchedPerson.map((r) => r.source),
    orphan_team_members: orphanTeam.map((r) => r.source),
    duplicate_member_pairs: dupMembers,
  };
}

// ── leave ───────────────────────────────────────────────────────────────

if (wantLeave) {
  const leave = await readAll(
    source
      .from('leave_requests')
      .select('id, requester_name, leave_type, date_start, date_end, note, approver_name, individual_days, status, archived')
      .eq('org_id', SKS_ORG_ID),
    'nspbmir leave_requests',
  );

  const results = leave.map((l) => transformLeave(l, TENANT_ID, resolver));
  const ok = results.filter((r) => r.ok);
  const unmatchedReq = results.filter((r) => r.issues.includes('unmatched_requester'));
  const ambiguousReq = results.filter((r) => r.issues.includes('ambiguous_requester'));
  const missingDates = results.filter((r) => r.issues.includes('missing_dates'));
  const lossyDays = results.filter((r) => r.warnings.includes('lossy_individual_days'));
  const unmatchedApprover = results.filter((r) => r.warnings.includes('unmatched_approver'));
  const unmappedType = results.filter((r) => r.warnings.includes('unmapped_leave_type'));

  report.surfaces.leave = {
    source_leave_requests: leave.length,
    would_insert: ok.length,
    blocked: results.length - ok.length,
    unmatched_requester: unmatchedReq.map((r) => r.source),
    ambiguous_requester: ambiguousReq.map((r) => r.source),
    missing_dates: missingDates.map((r) => r.source),
    needs_decision_individual_days: lossyDays.map((r) => r.source),
    unmatched_approver: unmatchedApprover.map((r) => r.source),
    unmapped_leave_type: unmappedType.map((r) => r.source),
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
  console.log(bar);
  console.log(' nspbmir → ehow ETL — DRY RUN (report only, no writes)');
  console.log(bar);
  console.log(`  source         ${r.meta.source}`);
  console.log(`  target         ${r.meta.target}`);
  console.log(`  ehow tenant    ${r.meta.ehow_tenant_id}`);
  console.log(`  sks org        ${r.meta.sks_org_id}  (demo ${r.meta.excluded_demo_org_id} excluded)`);
  console.log(`  bridge staff   ${r.meta.bridge_staff_count}`);
  if (r.meta.bridge_ambiguous_names.length) {
    console.log(`  ⚠ ambiguous names in bridge: ${r.meta.bridge_ambiguous_names.join(', ')}`);
  }

  if (r.surfaces.teams) {
    const t = r.surfaces.teams;
    console.log(bar);
    console.log(' TEAMS');
    console.log(`  source teams ............ ${t.source_teams}`);
    console.log(`  source team_members ..... ${t.source_team_members}`);
    console.log(`  would insert teams ...... ${t.would_insert_teams}`);
    console.log(`  would insert members .... ${t.would_insert_team_members}`);
    console.log(`  unmatched person ........ ${t.unmatched_person.length}`);
    console.log(`  orphan-team members ..... ${t.orphan_team_members.length}`);
    console.log(`  duplicate member pairs .. ${t.duplicate_member_pairs.length}`);
  }

  if (r.surfaces.leave) {
    const l = r.surfaces.leave;
    console.log(bar);
    console.log(' LEAVE');
    console.log(`  source leave requests ... ${l.source_leave_requests}`);
    console.log(`  would insert ............ ${l.would_insert}`);
    console.log(`  blocked ................. ${l.blocked}`);
    console.log(`    unmatched requester ... ${l.unmatched_requester.length}`);
    console.log(`    ambiguous requester ... ${l.ambiguous_requester.length}`);
    console.log(`    missing dates ......... ${l.missing_dates.length}`);
    console.log(`  ⚠ needs decision (non-contiguous individual_days): ${l.needs_decision_individual_days.length}`);
    console.log(`    unmatched approver .... ${l.unmatched_approver.length}`);
    console.log(`    unmapped leave_type ... ${l.unmapped_leave_type.length}`);
  }

  console.log(bar);
  console.log('  DRY RUN — nothing was written. Review unmatched / needs-decision');
  console.log('  rows above, then hand this report to Royce. --apply is gated off');
  console.log('  on this branch (see applyStub).');
  console.log(bar);
}

function applyStub() {
  console.error('');
  console.error('  ✕ --apply is NOT available on this branch.');
  console.error('');
  console.error('  This ETL is DRY-RUN / report-only by design. The write path is');
  console.error('  intentionally unimplemented here — no INSERT/UPSERT exists in this');
  console.error('  file. Royce wires + runs the apply path separately, AFTER:');
  console.error('    1. the dry-run report is reviewed (unmatched + needs-decision rows),');
  console.error('    2. the ehow app_data.teams / team_members / leave_requests target');
  console.error('       tables exist (governed DDL migration — see PR notes),');
  console.error('    3. live service keys are supplied.');
  console.error('');
  process.exit(3);
}

function requireEnvs(names) {
  const out = {};
  const missing = [];
  for (const n of names) {
    const v = process.env[n];
    if (!v) missing.push(n);
    else out[n] = v;
  }
  if (missing.length) fail(1, `Missing env vars: ${missing.join(', ')}`);
  return out;
}

function log(msg) { if (!args.json) console.error(`[${new Date().toISOString()}] ${msg}`); }
function fail(code, msg) { console.error(`ERROR: ${msg}`); process.exit(code); }
