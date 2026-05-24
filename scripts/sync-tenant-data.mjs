#!/usr/bin/env node
// scripts/sync-tenant-data.mjs
//
// Copy a tenant's app_data rows from the shared eq-canonical project into
// the tenant's dedicated data plane (e.g. eq-canonical-internal, sks-canonical).
//
// Phase 2.B.4 / 2.B.5 cut-over operation. Read this first:
//   docs/ARCHITECTURE-V2.md "Migration sequence (current → target)"
//
// What it copies (in dependency order):
//   customers → sites → staff → contacts → licences → jobs
//
// What it does NOT touch:
//   - Tables outside the 6-table "frontier" — those migrate later, table by
//     table, as their consuming apps move to canonical-api.
//   - Tenant routing — that's set up by scripts/provision-tenant.mjs.
//   - The shared eq-canonical app_data rows themselves — preserved for 14
//     days of rollback retention per the architecture doc.
//
// Idempotency:
//   - Uses UPSERT (ON CONFLICT DO UPDATE) on each row's primary key
//   - Safe to re-run; later runs reconcile any rows that changed in the
//     shared eq-canonical between runs
//   - --dry-run prints counts only, writes nothing
//
// Usage:
//   node scripts/sync-tenant-data.mjs --slug=core --dry-run
//   node scripts/sync-tenant-data.mjs --slug=core
//   node scripts/sync-tenant-data.mjs --slug=sks  --batch-size=500
//
// Required env vars:
//   SHARED_SUPABASE_URL          shared eq-canonical URL (jvknxcm...)
//   SHARED_SUPABASE_SERVICE_KEY  shared eq-canonical service-role
//   CONTROL_SUPABASE_URL         control-plane URL (same as SHARED for now)
//   CONTROL_SUPABASE_SERVICE_KEY control-plane service-role
//   TENANT_ROUTING_MASTER_KEY    master key from Netlify env
//
// Exit codes: 0 = success, 1 = config, 2 = data error.

import { createClient } from '@supabase/supabase-js';
import { createDecipheriv } from 'node:crypto';
import { parseArgs } from 'node:util';

// Tables, in foreign-key-safe order. Each entry: { name, pk, tenant_col }.
//
// Order rules:
//   1. Parents before children (FKs require parent row to exist).
//   2. Tables with no in-schema FK can come first in any order.
//   3. quote_* family lands after quote; tender_* after tenders;
//      apprentice_* dependents (buddy_checkins, engagement_logs, etc.)
//      after apprentice_profiles.
//
// All FKs to control-plane (shell_control.users) are soft references in
// tenant DBs — Postgres no longer enforces them. The 0002 migration
// strips those FKs at apply time.
const PLAN = [
  // 0001 baseline — frontier tables
  { name: 'customers',            pk: 'customer_id',          tenant_col: 'tenant_id' },
  { name: 'sites',                pk: 'site_id',              tenant_col: 'tenant_id' },
  { name: 'staff',                pk: 'staff_id',             tenant_col: 'tenant_id' },
  { name: 'contacts',             pk: 'contact_id',           tenant_col: 'tenant_id' },
  { name: 'licences',             pk: 'licence_id',           tenant_col: 'tenant_id' },
  { name: 'jobs',                 pk: 'job_id',               tenant_col: 'tenant_id' },

  // Leaf tables (no in-schema FKs)
  { name: 'rate_library',         pk: 'rate_id',              tenant_col: 'tenant_id' },
  { name: 'scope_template',       pk: 'template_id',          tenant_col: 'tenant_id' },
  { name: 'tenant_app_configs',   pk: 'config_id',            tenant_col: 'tenant_id' },
  { name: 'tafe_calendars',       pk: 'tafe_calendar_id',     tenant_col: 'tenant_id' },

  // Children of staff/sites/customers (0001 parents)
  { name: 'apprentice_profiles',  pk: 'apprentice_profile_id', tenant_col: 'tenant_id' },
  { name: 'assets',               pk: 'asset_id',             tenant_col: 'tenant_id' },
  { name: 'checkins',             pk: 'checkin_id',           tenant_col: 'tenant_id' },
  { name: 'incidents',            pk: 'incident_id',          tenant_col: 'tenant_id' },
  { name: 'leave_balances',       pk: 'leave_balance_id',     tenant_col: 'tenant_id' },
  { name: 'leave_requests',       pk: 'leave_request_id',     tenant_col: 'tenant_id' },
  { name: 'prestart_checks',      pk: 'prestart_id',          tenant_col: 'tenant_id' },
  { name: 'schedule_entries',     pk: 'schedule_id',          tenant_col: 'tenant_id' },
  { name: 'site_diaries',         pk: 'site_diary_id',        tenant_col: 'tenant_id' },
  { name: 'swms',                 pk: 'swms_id',              tenant_col: 'tenant_id' },
  { name: 'tenders',              pk: 'tender_id',            tenant_col: 'tenant_id' },
  { name: 'timesheets',           pk: 'timesheet_id',         tenant_col: 'tenant_id' },
  { name: 'toolbox_talks',        pk: 'talk_id',              tenant_col: 'tenant_id' },
  { name: 'weekly_reports',       pk: 'weekly_report_id',     tenant_col: 'tenant_id' },
  { name: 'quote',                pk: 'quote_id',             tenant_col: 'tenant_id' },

  // Children of 0002 parents
  { name: 'buddy_checkins',           pk: 'buddy_checkin_id',     tenant_col: 'tenant_id' },
  { name: 'engagement_logs',          pk: 'engagement_log_id',    tenant_col: 'tenant_id' },
  { name: 'feedback_entries',         pk: 'feedback_entry_id',    tenant_col: 'tenant_id' },
  { name: 'itp_records',              pk: 'itp_id',               tenant_col: 'tenant_id' },
  { name: 'jsa_records',              pk: 'jsa_id',               tenant_col: 'tenant_id' },
  { name: 'leave_approval_logs',      pk: 'log_id',               tenant_col: 'tenant_id' },
  { name: 'quarterly_reviews',        pk: 'quarterly_review_id',  tenant_col: 'tenant_id' },
  { name: 'rotations',                pk: 'rotation_id',          tenant_col: 'tenant_id' },
  { name: 'schedule_change_logs',     pk: 'log_id',               tenant_col: 'tenant_id' },
  { name: 'skills_ratings',           pk: 'skills_rating_id',     tenant_col: 'tenant_id' },
  { name: 'tender_enrichments',       pk: 'enrichment_id',        tenant_col: 'tenant_id' },
  { name: 'tender_import_runs',       pk: 'import_run_id',        tenant_col: 'tenant_id' },
  { name: 'tender_nominations',       pk: 'nomination_id',        tenant_col: 'tenant_id' },
  { name: 'tender_review_decisions',  pk: 'decision_id',          tenant_col: 'tenant_id' },

  // Quote family (children of quote)
  { name: 'quote_line_item',          pk: 'line_item_id',         tenant_col: 'tenant_id' },
  { name: 'quote_status_history',     pk: 'history_id',           tenant_col: 'tenant_id' },
  { name: 'quote_attachment',         pk: 'attachment_id',        tenant_col: 'tenant_id' },
  { name: 'quote_email_outbox',       pk: 'outbox_id',            tenant_col: 'tenant_id' },
];

// ─── args + env ────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    slug:         { type: 'string' },
    'dry-run':    { type: 'boolean', default: false },
    'batch-size': { type: 'string',  default: '500' },
  },
});

if (!args.slug) fail(1, 'usage: --slug=<tenant>');
const BATCH = parseInt(args['batch-size'], 10);
if (!Number.isFinite(BATCH) || BATCH < 1 || BATCH > 5000) {
  fail(1, '--batch-size must be 1..5000');
}

const env = requireEnvs([
  'SHARED_SUPABASE_URL', 'SHARED_SUPABASE_SERVICE_KEY',
  'CONTROL_SUPABASE_URL', 'CONTROL_SUPABASE_SERVICE_KEY',
  'TENANT_ROUTING_MASTER_KEY',
]);
const masterKey = validateMasterKey(env.TENANT_ROUTING_MASTER_KEY);

const shared = createClient(env.SHARED_SUPABASE_URL, env.SHARED_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const control = createClient(env.CONTROL_SUPABASE_URL, env.CONTROL_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db:   { schema: 'shell_control' },
});

// ─── resolve tenant + target client ────────────────────────────────────

const { data: tenant, error: tErr } = await control
  .from('tenants')
  .select('id, slug, name')
  .eq('slug', args.slug)
  .maybeSingle();
if (tErr || !tenant) fail(1, `tenant '${args.slug}' not found: ${tErr?.message ?? 'no row'}`);

const { data: routing, error: rErr } = await control
  .from('tenant_routing')
  .select('supabase_url, service_role_key_ciphertext, service_role_key_iv, service_role_key_tag, status')
  .eq('tenant_id', tenant.id)
  .maybeSingle();
if (rErr || !routing) fail(1, `tenant_routing missing for '${args.slug}' — run provision-tenant.mjs first`);

const targetKey = decryptSecret({
  ciphertext: routing.service_role_key_ciphertext,
  iv:         routing.service_role_key_iv,
  tag:        routing.service_role_key_tag,
});
const target = createClient(routing.supabase_url, targetKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

log(`Sync target: ${routing.supabase_url} (status=${routing.status})`);
log(`Tenant:      ${tenant.slug} (${tenant.id})`);
if (args['dry-run']) log('DRY RUN — no writes will be made');

// ─── per-table sync ────────────────────────────────────────────────────

const summary = [];

for (const table of PLAN) {
  const t0 = Date.now();
  const stat = await syncTable(table);
  stat.ms = Date.now() - t0;
  summary.push({ table: table.name, ...stat });
  log(`  ${table.name.padEnd(12)} read=${stat.read}  wrote=${stat.wrote}  ${stat.ms}ms`);
}

console.log('');
console.log('━'.repeat(70));
console.log(' SYNC SUMMARY ' + (args['dry-run'] ? '(dry-run)' : ''));
console.log('━'.repeat(70));
for (const s of summary) {
  console.log(`  ${s.table.padEnd(12)} ${String(s.read).padStart(6)} read   ${String(s.wrote).padStart(6)} wrote   ${s.ms}ms`);
}
console.log('━'.repeat(70));

const totalRead = summary.reduce((a, s) => a + s.read, 0);
const totalWrote = summary.reduce((a, s) => a + s.wrote, 0);
console.log(`  TOTAL        ${String(totalRead).padStart(6)} read   ${String(totalWrote).padStart(6)} wrote`);
console.log('');
console.log(args['dry-run']
  ? '  (dry run — no rows were written. Re-run without --dry-run to commit.)'
  : `  Next: verify counts in target, then UPDATE tenant_routing SET status='active' WHERE tenant_id='${tenant.id}'.`);
console.log('━'.repeat(70));

process.exit(0);

// ──────────────────────────────────────────────────────────────────────
// per-table sync
// ──────────────────────────────────────────────────────────────────────

async function syncTable({ name, pk, tenant_col }) {
  let read = 0, wrote = 0, offset = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharedAny = shared;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetAny = target;

  while (true) {
    const { data: rows, error: readErr } = await sharedAny
      .schema('app_data')
      .from(name)
      .select('*')
      .eq(tenant_col, tenant.id)
      .order(pk)
      .range(offset, offset + BATCH - 1);

    if (readErr) fail(2, `${name}: read failed at offset=${offset}: ${readErr.message}`);
    if (!rows || rows.length === 0) break;
    read += rows.length;

    if (!args['dry-run']) {
      const { error: writeErr } = await targetAny
        .schema('app_data')
        .from(name)
        .upsert(rows, { onConflict: pk, ignoreDuplicates: false });

      if (writeErr) fail(2, `${name}: write failed at offset=${offset}: ${writeErr.message}`);
      wrote += rows.length;
    }

    if (rows.length < BATCH) break;
    offset += rows.length;
  }

  return { read, wrote };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function decryptSecret({ ciphertext, iv, tag }) {
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

function validateMasterKey(hex) {
  const cleaned = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) fail(1, 'TENANT_ROUTING_MASTER_KEY: not hex');
  const buf = Buffer.from(cleaned, 'hex');
  if (buf.length !== 32) fail(1, `TENANT_ROUTING_MASTER_KEY: must decode to 32 bytes, got ${buf.length}`);
  return buf;
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

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function fail(code, msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}
