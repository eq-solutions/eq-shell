#!/usr/bin/env node
// scripts/migrate-tenants.mjs
//
// Apply every pending tenant-plane migration (supabase/tenant-migrations/*.sql)
// to every tenant data plane — thin over the Supabase **Management API**.
//
// WHY THIS REWRITE (2026-05-30): the previous runner applied SQL through a
// per-tenant `public.exec_sql(text)` SECURITY DEFINER function and bootstrapped
// (RE-CREATED) it on first run if missing. That function is an arbitrary-SQL
// backdoor — the root cause of hand-applied drift — and was DROPPED from every
// tenant in migration 0027. A runner that recreates it would silently undo that
// fix. This version uses ONLY the Management API (POST /v1/projects/{ref}/
// database/query) via scripts/_mgmt.mjs: no exec_sql, no service-key decryption.
//
// CHECKSUM-AWARE: a migration whose name is already recorded but whose file
// content has changed is treated as DRIFT and the tenant is failed (unless
// --allow-checksum-drift). A legacy row recorded WITHOUT a checksum (the old
// runner left these null) can't be drift-checked — we warn and backfill the
// checksum so future runs can, rather than silently trusting it.
//
// Usage:
//   node scripts/migrate-tenants.mjs                     # all provisioning+active tenants
//   node scripts/migrate-tenants.mjs --slug=core         # one tenant
//   node scripts/migrate-tenants.mjs --dry-run           # show plan, change nothing
//   node scripts/migrate-tenants.mjs --include-suspended # include suspended tenants (rare)
//   node scripts/migrate-tenants.mjs --allow-checksum-drift  # re-accept changed files (careful)
//
// Required env:
//   SUPABASE_ACCESS_TOKEN   A Supabase personal or org access token (Management API).
//   CONTROL_PROJECT_REF     Control-plane project ref (jvkn…) holding shell_control.
//                           (Falls back to deriving from CONTROL_SUPABASE_URL.)
//
// Exit codes: 0 = all applied, 1 = config error, 2 = at least one tenant failed.

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { mgmtQuery, mgmtRows, loadActiveTenants, sqlLiteral, mapWithConcurrency, requireAccessToken } from './_mgmt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'tenant-migrations');
const CONCURRENCY = 3;   // tenants in flight at once; keeps under Management API rate limits

const { values: args } = parseArgs({
  options: {
    slug:                  { type: 'string' },
    'dry-run':             { type: 'boolean', default: false },
    'include-suspended':   { type: 'boolean', default: false },
    'allow-checksum-drift':{ type: 'boolean', default: false },
  },
});

requireAccessToken();   // fail fast on missing token before any work

// ─── load migrations from disk ─────────────────────────────────────────

const migrationFiles = (await readdir(MIGRATIONS_DIR))
  .filter(f => f.endsWith('.sql'))
  .sort();    // filename-sorted = order-of-application

if (migrationFiles.length === 0) {
  log('No migration files in supabase/tenant-migrations/. Nothing to do.');
  process.exit(0);
}

const migrations = await Promise.all(
  migrationFiles.map(async (name) => {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    return { name, sql, checksum: sha256(sql) };
  })
);

log(`Loaded ${migrations.length} migration(s): ${migrationFiles.join(', ')}`);

// ─── load tenants (Management API) ─────────────────────────────────────

let routingRows;
try {
  routingRows = await loadActiveTenants({ includeSuspended: args['include-suspended'], slug: args.slug });
} catch (e) {
  fail(1, `tenant lookup failed: ${e.message}`);
}
if (!routingRows.length) {
  log(args.slug ? `No tenant routing for slug='${args.slug}'` : 'No provisioning/active tenants in tenant_routing');
  process.exit(0);
}

log(`Targets: ${routingRows.map(r => `${r.slug} (${r.status} → ${r.ref})`).join(', ')}`);
if (args['dry-run']) log('DRY RUN — no migrations will be applied');

// ─── apply per-tenant (bounded concurrency) ────────────────────────────

const results = await mapWithConcurrency(routingRows, CONCURRENCY, applyMigrationsToTenant);

console.log('\n' + '━'.repeat(70));
console.log(' MIGRATION SUMMARY');
console.log('━'.repeat(70));
let anyFailed = false;
for (const r of results) {
  const tag = r.ok ? '✓' : '✗';
  console.log(` ${tag} ${r.slug.padEnd(20)} ${r.applied.length} applied, ${r.skipped.length} skipped${r.error ? ' — ' + r.error : ''}`);
  for (const w of r.warnings) console.log(`     ! ${w}`);
  if (!r.ok) anyFailed = true;
}
console.log('━'.repeat(70));
process.exit(anyFailed ? 2 : 0);

// ──────────────────────────────────────────────────────────────────────

async function applyMigrationsToTenant(routing) {
  const { ref, slug } = routing;
  const result = { slug, ok: false, applied: [], skipped: [], warnings: [], error: null };

  try {
    if (!args['dry-run']) {
      await mgmtQuery(ref, `
        CREATE SCHEMA IF NOT EXISTS app_data;
        CREATE TABLE IF NOT EXISTS app_data._eq_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now(),
          checksum text
        );
      `);
    }

    const applied = args['dry-run'] ? new Map() : await loadApplied(ref);

    for (const m of migrations) {
      if (applied.has(m.name)) {
        const recorded = applied.get(m.name);
        if (recorded == null) {
          // Legacy row with no checksum — can't verify drift. Backfill from disk
          // (assumes disk == applied, true for forward-only migrations) so future
          // runs CAN detect drift, and surface a warning that this run trusted it.
          result.warnings.push(`${m.name}: recorded without a checksum — backfilled from disk (drift not verifiable for this row)`);
          if (!args['dry-run']) {
            await mgmtQuery(ref, `UPDATE app_data._eq_migrations SET checksum = ${sqlLiteral(m.checksum)} WHERE name = ${sqlLiteral(m.name)} AND checksum IS NULL;`);
          }
          result.skipped.push(m.name);
          continue;
        }
        if (recorded !== m.checksum && !args['allow-checksum-drift']) {
          throw new Error(
            `checksum drift on ${m.name} (recorded ${recorded.slice(0, 12)}…, disk ${m.checksum.slice(0, 12)}…). ` +
            `The file changed after it was applied — author a new forward migration, or re-run with --allow-checksum-drift.`);
        }
        result.skipped.push(m.name);
        continue;
      }

      log(`  [${slug}] applying ${m.name}…`);
      if (args['dry-run']) { result.applied.push(m.name); continue; }

      // Apply the migration AND record it in a single Management API call, so the
      // tracking insert can't be lost in a separate round-trip after the DDL
      // committed. Migrations are idempotent, so a failed call re-runs safely.
      await mgmtQuery(ref, m.sql + `\n;\n` +
        `INSERT INTO app_data._eq_migrations(name, checksum) ` +
        `VALUES (${sqlLiteral(m.name)}, ${sqlLiteral(m.checksum)}) ` +
        `ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();`);
      result.applied.push(m.name);
      log(`  [${slug}] ✓ ${m.name}`);
    }
    result.ok = true;
  } catch (err) {
    result.error = err?.message ?? String(err);
    log(`  [${slug}] ✗ ${result.error}`);
  }
  return result;
}

async function loadApplied(ref) {
  const rows = await mgmtRows(ref, `SELECT name, checksum FROM app_data._eq_migrations;`);
  return new Map(rows.map(r => [r.name, r.checksum]));
}

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function fail(code, msg) { console.error(`ERROR: ${msg}`); process.exit(code); }
