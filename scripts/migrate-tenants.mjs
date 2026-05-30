#!/usr/bin/env node
// scripts/migrate-tenants.mjs
//
// Apply every pending tenant-plane migration (supabase/tenant-migrations/*.sql)
// to every tenant data plane — thin over the Supabase **Management API**.
//
// WHY THIS REWRITE (2026-05-30): the previous runner applied SQL through a
// per-tenant `public.exec_sql(text)` SECURITY DEFINER function, and bootstrapped
// (RE-CREATED) it on first run if missing. That function is an arbitrary-SQL
// backdoor — it was the root cause of hand-applied drift and was DROPPED from
// every tenant in migration 0027. A runner that recreates it would silently
// undo that security fix. This version uses ONLY the Management API
// (POST /v1/projects/{ref}/database/query), which runs DDL as `postgres`
// authenticated by your personal/org access token — no exec_sql, no service-key
// decryption, no secrets in the runner beyond the access token.
//
// It is also CHECKSUM-AWARE: a migration whose name is already recorded but
// whose file content has since changed is treated as DRIFT and the tenant is
// failed (not silently skipped or re-applied) unless --allow-checksum-drift.
//
// Usage:
//   node scripts/migrate-tenants.mjs                     # all provisioning+active tenants
//   node scripts/migrate-tenants.mjs --slug=core         # one tenant
//   node scripts/migrate-tenants.mjs --dry-run           # show plan, change nothing
//   node scripts/migrate-tenants.mjs --include-suspended # include suspended tenants (rare)
//   node scripts/migrate-tenants.mjs --allow-checksum-drift  # re-apply changed files (careful)
//
// Required env:
//   SUPABASE_ACCESS_TOKEN   A Supabase personal or org access token (Management API).
//   CONTROL_PROJECT_REF     Project ref of the control plane (jvkn…) that holds
//                           shell_control.tenant_routing + tenants.
//
// Exit codes: 0 = all applied, 1 = config error, 2 = at least one tenant failed.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'tenant-migrations');
const MGMT = 'https://api.supabase.com/v1';

// ─── args + env ────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    slug:                  { type: 'string' },
    'dry-run':             { type: 'boolean', default: false },
    'include-suspended':   { type: 'boolean', default: false },
    'allow-checksum-drift':{ type: 'boolean', default: false },
  },
});

const env = requireEnvs(['SUPABASE_ACCESS_TOKEN', 'CONTROL_PROJECT_REF']);

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

// ─── load tenants from the control plane (via Management API) ──────────

const statuses = args['include-suspended']
  ? `'provisioning','active','suspended'`
  : `'provisioning','active'`;

const slugFilter = args.slug ? `AND t.slug = ${sqlLiteral(args.slug)}` : '';

const routingRows = await mgmtQuery(env.CONTROL_PROJECT_REF, `
  SELECT tr.supabase_project_ref AS ref, tr.status AS status, t.slug AS slug
  FROM shell_control.tenant_routing tr
  JOIN shell_control.tenants t ON t.tenant_id = tr.tenant_id
  WHERE tr.status IN (${statuses}) ${slugFilter}
  ORDER BY t.slug;
`).catch(e => fail(1, `tenant_routing query failed: ${e.message}`));

if (!routingRows || routingRows.length === 0) {
  log(args.slug
    ? `No tenant routing for slug='${args.slug}' (status in ${statuses})`
    : `No tenants in tenant_routing with status in ${statuses}`);
  process.exit(0);
}

log(`Targets: ${routingRows.map(r => `${r.slug} (${r.status} → ${r.ref})`).join(', ')}`);
if (args['dry-run']) log('DRY RUN — no migrations will be applied');

// ─── apply per-tenant ──────────────────────────────────────────────────

const results = [];
for (const r of routingRows) {
  results.push(await applyMigrationsToTenant(r));   // sequential — Management API is rate-limited
}

console.log('\n' + '━'.repeat(70));
console.log(' MIGRATION SUMMARY');
console.log('━'.repeat(70));
let anyFailed = false;
for (const r of results) {
  const tag = r.ok ? '✓' : '✗';
  console.log(` ${tag} ${r.slug.padEnd(20)} ${r.applied.length} applied, ${r.skipped.length} skipped${r.error ? ' — ' + r.error : ''}`);
  if (!r.ok) anyFailed = true;
}
console.log('━'.repeat(70));
process.exit(anyFailed ? 2 : 0);

// ──────────────────────────────────────────────────────────────────────
// per-tenant runner
// ──────────────────────────────────────────────────────────────────────

async function applyMigrationsToTenant(routing) {
  const { ref, slug } = routing;
  const result = { slug, ok: false, applied: [], skipped: [], error: null };

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

    const applied = args['dry-run']
      ? new Map()
      : await loadApplied(ref);

    for (const m of migrations) {
      if (applied.has(m.name)) {
        const recorded = applied.get(m.name);
        if (recorded && recorded !== m.checksum && !args['allow-checksum-drift']) {
          throw new Error(
            `checksum drift on ${m.name} (recorded ${recorded.slice(0, 12)}…, ` +
            `disk ${m.checksum.slice(0, 12)}…). The file changed after it was applied. ` +
            `Author a new forward migration instead, or re-run with --allow-checksum-drift.`);
        }
        result.skipped.push(m.name);
        continue;
      }
      log(`  [${slug}] applying ${m.name}…`);
      if (args['dry-run']) { result.applied.push(m.name); continue; }

      await mgmtQuery(ref, m.sql);
      await mgmtQuery(ref, `
        INSERT INTO app_data._eq_migrations(name, checksum)
        VALUES (${sqlLiteral(m.name)}, ${sqlLiteral(m.checksum)})
        ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();
      `);
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
  const rows = await mgmtQuery(ref, `SELECT name, checksum FROM app_data._eq_migrations;`);
  return new Map((rows ?? []).map(r => [r.name, r.checksum]));
}

// ──────────────────────────────────────────────────────────────────────
// Management API
// ──────────────────────────────────────────────────────────────────────

// Run SQL against a project via the Supabase Management API. Returns the row
// array for SELECTs, [] for DDL. Authenticated by SUPABASE_ACCESS_TOKEN — runs
// as `postgres`, so it can apply DDL without any per-tenant exec_sql function.
async function mgmtQuery(ref, query) {
  const res = await fetch(`${MGMT}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API query failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : [];
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

// Single-quote a string for inline SQL (names/checksums are alnum, but be safe).
function sqlLiteral(s) { return `'${String(s).replace(/'/g, "''")}'`; }

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
function fail(code, msg) { console.error(`ERROR: ${msg}`); process.exit(code); }
