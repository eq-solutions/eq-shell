#!/usr/bin/env node
/**
 * migrate-nspbmir-to-ehowg.mjs
 *
 * One-shot migration: nspbmir (SKS standalone Field DB) → ehowg (EQ canonical SKS tenant DB)
 *
 * Migrates operational Field data that was NOT in the original static migration:
 *   schedule      (761 rows) — weekly roster rows per person
 *   timesheets    (195 rows) — weekly timesheet rows per person
 *   leave_requests (60 rows) — leave requests
 *   teams          (6 rows)  — team groups
 *   team_members  (48 rows)  — team assignments
 *   tenders       (383 rows) — pipeline tenders (+ enrichment)
 *
 * Prerequisites:
 *   1. sks-field.netlify.app is live and working
 *   2. ehowg has teams/team_members/timesheet_locks tables (migration 2026_06_07_ehowg_field_extras.sql applied)
 *   3. You have service-role keys for both databases
 *
 * Usage:
 *   NSPBMIR_URL=https://nspbmirochztcjijmcrx.supabase.co \
 *   NSPBMIR_SERVICE_KEY=<service_role_key> \
 *   EHOWG_URL=https://ehowgjardagevnrluult.supabase.co \
 *   EHOWG_SERVICE_KEY=<service_role_key> \
 *   SKS_TENANT_ID=7dee117c-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
 *   SKS_ORG_ID=<nspbmir org_id for SKS (not demo)> \
 *   node scripts/migrate-nspbmir-to-ehowg.mjs [--dry-run]
 *
 * The script is IDEMPOTENT — re-running skips rows already migrated.
 * In --dry-run mode it prints counts but writes nothing.
 */

const DRY_RUN = process.argv.includes('--dry-run');

const NSPBMIR_URL         = process.env.NSPBMIR_URL;
const NSPBMIR_SERVICE_KEY = process.env.NSPBMIR_SERVICE_KEY;
const EHOWG_URL           = process.env.EHOWG_URL;
const EHOWG_SERVICE_KEY   = process.env.EHOWG_SERVICE_KEY;
const SKS_TENANT_ID       = process.env.SKS_TENANT_ID;   // ehowg tenant UUID
const SKS_ORG_ID          = process.env.SKS_ORG_ID;       // nspbmir org_id for SKS (not demo)

for (const [k, v] of Object.entries({ NSPBMIR_URL, NSPBMIR_SERVICE_KEY, EHOWG_URL, EHOWG_SERVICE_KEY, SKS_TENANT_ID, SKS_ORG_ID })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

if (DRY_RUN) console.log('[dry-run] No writes will happen.\n');

// ── REST helpers ──────────────────────────────────────────────────────────────

async function src(path, opts = {}) {
  const res = await fetch(`${NSPBMIR_URL}/rest/v1/${path}`, {
    headers: { apikey: NSPBMIR_SERVICE_KEY, Authorization: `Bearer ${NSPBMIR_SERVICE_KEY}`, ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`nspbmir ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function dst(path, body, opts = {}) {
  if (DRY_RUN) { console.log(`  [dry] POST ${path} (${Array.isArray(body) ? body.length : 1} rows)`); return; }
  const res = await fetch(`${EHOWG_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: EHOWG_SERVICE_KEY,
      Authorization: `Bearer ${EHOWG_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=ignore-duplicates',
      ...opts.headers,
    },
    body: JSON.stringify(body),
    ...opts,
  });
  if (!res.ok) throw new Error(`ehowg ${path}: ${res.status} ${await res.text()}`);
}

// ── Build person ID → canonical staff_id map ──────────────────────────────────
// nspbmir.people has canonical_id which was set during the original staff migration.

async function buildPersonMap() {
  console.log('Building person → staff_id map via canonical_id...');

  // All SKS people with a canonical_id
  const people = await src(`people?org_id=eq.${SKS_ORG_ID}&canonical_id=not.is.null&select=id,name,email,canonical_id`);

  // All ehowg staff to cross-reference
  const staffRes = await fetch(`${EHOWG_URL}/rest/v1/staff?tenant_id=eq.${SKS_TENANT_ID}&select=staff_id,external_id,email,first_name,last_name`, {
    headers: { apikey: EHOWG_SERVICE_KEY, Authorization: `Bearer ${EHOWG_SERVICE_KEY}` },
  });
  const staff = await staffRes.json();

  const canonicalToStaff = new Map(staff.map(s => [s.staff_id, s]));

  const map = new Map(); // nspbmir person bigint id → ehowg staff uuid
  let linked = 0, unlinked = 0;

  for (const p of people) {
    // Primary: canonical_id IS the ehowg staff_id (set during migration)
    if (canonicalToStaff.has(p.canonical_id)) {
      map.set(p.id, p.canonical_id);
      linked++;
    } else {
      // Fallback: match by email
      const byEmail = staff.find(s => s.email && p.email && s.email.toLowerCase() === p.email.toLowerCase());
      if (byEmail) { map.set(p.id, byEmail.staff_id); linked++; }
      else { console.warn(`  ⚠ No staff match for person ${p.id} "${p.name}" (canonical_id=${p.canonical_id})`); unlinked++; }
    }
  }

  console.log(`  Linked: ${linked} / Unlinked: ${unlinked} of ${people.length} people\n`);
  return map;
}

// ── 1. Teams ──────────────────────────────────────────────────────────────────

async function migrateTeams() {
  console.log('Migrating teams...');
  const teams = await src(`teams?org_id=eq.${SKS_ORG_ID}&select=id,name,color,created_at`);
  console.log(`  Source: ${teams.length} teams`);
  if (!teams.length) return new Map();

  const rows = teams.map(t => ({
    tenant_id:   SKS_TENANT_ID,
    nspbmir_id:  t.id,
    name:        t.name,
    color:       t.color ?? null,
    created_at:  t.created_at,
  }));

  await dst('teams?schema=app_data', rows);
  console.log(`  ✓ Inserted/skipped ${rows.length} teams\n`);

  // Build nspbmir team bigint id → ehowg team uuid map
  if (DRY_RUN) return new Map();
  const inserted = await fetch(`${EHOWG_URL}/rest/v1/teams?tenant_id=eq.${SKS_TENANT_ID}&select=id,nspbmir_id`, {
    headers: { apikey: EHOWG_SERVICE_KEY, Authorization: `Bearer ${EHOWG_SERVICE_KEY}`, 'Accept-Profile': 'app_data' },
  }).then(r => r.json());
  return new Map(inserted.filter(t => t.nspbmir_id).map(t => [t.nspbmir_id, t.id]));
}

// ── 2. Team members ───────────────────────────────────────────────────────────

async function migrateTeamMembers(teamMap, personMap) {
  console.log('Migrating team_members...');
  const members = await src(`team_members?org_id=eq.${SKS_ORG_ID}&select=team_id,person_id,added_at`);
  console.log(`  Source: ${members.length} team_member rows`);

  const rows = [];
  let skipped = 0;
  for (const m of members) {
    const teamId   = teamMap.get(m.team_id);
    const staffId  = personMap.get(m.person_id);
    if (!teamId || !staffId) { skipped++; continue; }
    rows.push({ team_id: teamId, staff_id: staffId, tenant_id: SKS_TENANT_ID, added_at: m.added_at });
  }

  if (rows.length) await dst('team_members?schema=app_data', rows);
  console.log(`  ✓ Inserted ${rows.length} / skipped ${skipped} (no match)\n`);
}

// ── 3. Schedule (roster) ──────────────────────────────────────────────────────
// nspbmir uses a denormalized week-row-per-person format in public.schedule.
// ehowg app_data.schedule_entries uses the same shape (column names may differ).
// We map: name → person lookup, org_id → tenant_id.

async function migrateSchedule(personMap) {
  console.log('Migrating schedule (roster rows)...');

  // Check if ehowg has a schedule table (may be schedule or schedule_entries)
  const tableCheck = await fetch(`${EHOWG_URL}/rest/v1/schedule?tenant_id=eq.${SKS_TENANT_ID}&select=id&limit=1`, {
    headers: { apikey: EHOWG_SERVICE_KEY, Authorization: `Bearer ${EHOWG_SERVICE_KEY}`, 'Accept-Profile': 'app_data' },
  });

  if (!tableCheck.ok) {
    console.log('  ⚠ app_data.schedule does not exist on ehowg — skipping (add migration 0013 to create it)\n');
    return;
  }

  const rows = await src(`schedule?org_id=eq.${SKS_ORG_ID}&deleted_at=is.null&select=*`);
  console.log(`  Source: ${rows.length} schedule rows`);

  const toInsert = rows.map(r => ({
    tenant_id: SKS_TENANT_ID,
    name:      r.name,
    week:      r.week,
    mon: r.mon, tue: r.tue, wed: r.wed, thu: r.thu, fri: r.fri, sat: r.sat, sun: r.sun,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  if (toInsert.length) await dst('schedule?schema=app_data', toInsert);
  console.log(`  ✓ Inserted/skipped ${toInsert.length} schedule rows\n`);
}

// ── 4. Timesheets ─────────────────────────────────────────────────────────────

async function migrateTimesheets() {
  console.log('Migrating timesheets...');

  const tableCheck = await fetch(`${EHOWG_URL}/rest/v1/timesheets?tenant_id=eq.${SKS_TENANT_ID}&select=id&limit=1`, {
    headers: { apikey: EHOWG_SERVICE_KEY, Authorization: `Bearer ${EHOWG_SERVICE_KEY}`, 'Accept-Profile': 'app_data' },
  });

  if (!tableCheck.ok) {
    console.log('  ⚠ app_data.timesheets does not exist on ehowg — skipping\n');
    return;
  }

  const rows = await src(`timesheets?org_id=eq.${SKS_ORG_ID}&select=*`);
  console.log(`  Source: ${rows.length} timesheet rows`);

  const toInsert = rows.map(r => ({
    tenant_id:    SKS_TENANT_ID,
    name:         r.name,
    week:         r.week,
    mon: r.mon, tue: r.tue, wed: r.wed, thu: r.thu, fri: r.fri, sat: r.sat, sun: r.sun,
    mon_hrs: r.mon_hrs, tue_hrs: r.tue_hrs, wed_hrs: r.wed_hrs, thu_hrs: r.thu_hrs,
    fri_hrs: r.fri_hrs, sat_hrs: r.sat_hrs, sun_hrs: r.sun_hrs,
    mon_job: r.mon_job, tue_job: r.tue_job, wed_job: r.wed_job, thu_job: r.thu_job,
    fri_job: r.fri_job, sat_job: r.sat_job, sun_job: r.sun_job,
    group:        r.group ?? null,
    notes:        r.notes ?? null,
    submitted_by: r.submitted_by ?? null,
    approved:     r.approved ?? false,
    approved_by:  r.approved_by ?? null,
    approved_at:  r.approved_at ?? null,
    created_at:   r.created_at,
    updated_at:   r.updated_at,
  }));

  if (toInsert.length) await dst('timesheets?schema=app_data', toInsert);
  console.log(`  ✓ Inserted/skipped ${toInsert.length} timesheet rows\n`);
}

// ── 5. Leave requests ─────────────────────────────────────────────────────────

async function migrateLeaveRequests() {
  console.log('Migrating leave_requests...');

  const tableCheck = await fetch(`${EHOWG_URL}/rest/v1/leave_requests?tenant_id=eq.${SKS_TENANT_ID}&select=id&limit=1`, {
    headers: { apikey: EHOWG_SERVICE_KEY, Authorization: `Bearer ${EHOWG_SERVICE_KEY}`, 'Accept-Profile': 'app_data' },
  });

  if (!tableCheck.ok) {
    console.log('  ⚠ app_data.leave_requests does not exist on ehowg — skipping\n');
    return;
  }

  const rows = await src(`leave_requests?org_id=eq.${SKS_ORG_ID}&archived=eq.false&select=*`);
  console.log(`  Source: ${rows.length} leave_request rows`);

  const toInsert = rows.map(r => ({
    tenant_id:      SKS_TENANT_ID,
    requester_name: r.requester_name,
    leave_type:     r.leave_type,
    date_start:     r.date_start,
    date_end:       r.date_end,
    status:         r.status,
    note:           r.note ?? null,
    approver_name:  r.approver_name ?? null,
    response_note:  r.response_note ?? null,
    responded_by:   r.responded_by ?? null,
    responded_at:   r.responded_at ?? null,
    individual_days: r.individual_days ?? null,
    created_at:     r.created_at,
    updated_at:     r.updated_at,
  }));

  if (toInsert.length) await dst('leave_requests?schema=app_data', toInsert);
  console.log(`  ✓ Inserted/skipped ${toInsert.length} leave_request rows\n`);
}

// ── 6. Tenders + enrichment ───────────────────────────────────────────────────
// nspbmir.tenders (383 rows) → ehowg.app_data.tenders
// Stage mapping: nspbmir uses probability_label/stage; ehowg uses canonical vocab.

const STAGE_MAP = {
  'watch':       'watch',
  'confirmed':   'confirmed',
  'likely':      'likely',
  'won':         'won',
  'lost':        'lost',
  'withdrawn':   'withdrawn',
  // nspbmir-specific labels → canonical
  'verbal':      'likely',
  'award':       'won',
  'awarded':     'won',
};

async function migrateTenders() {
  console.log('Migrating tenders...');

  const tenders = await src(`tenders?org_id=eq.${SKS_ORG_ID}&archived_at=is.null&select=*`);
  console.log(`  Source: ${tenders.length} active tenders`);

  const toInsert = tenders.map(t => ({
    tenant_id:            SKS_TENANT_ID,
    external_id:          t.external_ref ?? t.id,
    title:                t.job_name,
    client_name:          t.client ?? null,
    stage:                STAGE_MAP[t.stage] ?? STAGE_MAP[t.probability_label?.toLowerCase()] ?? 'watch',
    close_date:           t.due_date ?? null,
    department:           t.department ?? null,
    scope_summary:        t.site_address ?? null,
    notes:                null,
    imported_at:          t.first_imported_at ?? t.created_at,
    imported_from:        'nspbmir-migration',
  }));

  if (toInsert.length) await dst('tenders?schema=app_data', toInsert);
  console.log(`  ✓ Inserted/skipped ${toInsert.length} tender rows\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== nspbmir → ehowg migration ===');
  console.log(`  Source: nspbmir (${NSPBMIR_URL}), org_id=${SKS_ORG_ID}`);
  console.log(`  Target: ehowg  (${EHOWG_URL}), tenant_id=${SKS_TENANT_ID}`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE WRITE'}\n`);

  const personMap = await buildPersonMap();
  const teamMap   = await migrateTeams();
                    await migrateTeamMembers(teamMap, personMap);
                    await migrateSchedule(personMap);
                    await migrateTimesheets();
                    await migrateLeaveRequests();
                    await migrateTenders();

  console.log('=== Done ===');
  if (!DRY_RUN) {
    console.log('\nNext steps:');
    console.log('  1. Verify row counts match expectations in ehowg app_data tables');
    console.log('  2. Walk sks-field.netlify.app — check roster, timesheets, leave, pipeline');
    console.log('  3. When satisfied: update sks-field to point to ehowg instead of nspbmir');
    console.log('     (Update TENANT_SUPABASE.sks in sks-nsw-labour/scripts/app-state.js,');
    console.log('      OR update the canonical org config in jvkn organisations table)');
    console.log('  4. Then retire sks-nsw-labour.netlify.app');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
