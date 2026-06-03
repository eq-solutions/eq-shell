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
//   node scripts/migrate-tenants.mjs --plan              # READ-ONLY: per-tenant matrix of what WOULD apply
//   node scripts/migrate-tenants.mjs --dry-run           # show plan, change nothing
//   node scripts/migrate-tenants.mjs --include-suspended # include suspended tenants (rare)
//   node scripts/migrate-tenants.mjs --allow-checksum-drift  # re-accept changed files (careful)
//   node scripts/migrate-tenants.mjs --reconcile-ledger [--dry-run]  # normalise the ledger (see below)
//
// LEDGER RECONCILE (--reconcile-ledger): one-time normaliser that brings each
// tenant's app_data._eq_migrations into agreement with the canonical filename
// set, WITHOUT touching schema or data. It (a) renames legacy un-suffixed rows
// (`0001_baseline` → `0001_baseline.sql`), (b) de-duplicates the `NNNN` vs
// `NNNN.sql` pairs the two historical runners left, (c) (re)stamps the correct
// LF-normalised checksum, and (d) drops rows from the old out-of-band eq-intake
// lineage (013…048) that aren't canonical files here. Migrations the tenant has
// never recorded are LEFT for a normal apply run — reconcile never applies SQL.
// Idempotent: a second run is a no-op. Pair it with --dry-run to preview.
//
// EOL NOTE: checksums are computed over LF-normalised content (\r\n → \n) so a
// migration applied from a Windows checkout and one applied from CI hash
// identically. Combined with `*.sql text eol=lf` in .gitattributes this removes
// the line-ending nondeterminism that previously produced phantom checksum drift.
//
// --plan vs --dry-run: --plan queries each tenant's _eq_migrations and reports
// only the genuinely pending migrations (the accurate apply matrix the CI plan
// job posts on a PR). --dry-run is the older "show every migration as a
// candidate" mode that never reads tenant state. --plan never writes — not even
// the _eq_migrations bootstrap — so it is safe to run against live tenants from
// an unprivileged PR context.
//
// NOTE ON ATOMICITY (why there is no outer BEGIN/COMMIT wrap here): half-apply
// is already prevented. Migration files that need a transaction wrap themselves
// (top-level BEGIN;…COMMIT;); the rest are applied together with the ledger
// INSERT as a single Management-API query string, which Postgres runs as one
// implicit transaction (simple-query protocol). Adding an outer BEGIN/COMMIT
// would NEST inside the self-wrapping files — the inner COMMIT would commit
// early and detach the ledger INSERT. Do not add one.
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
    plan:                  { type: 'boolean', default: false },
    'dry-run':             { type: 'boolean', default: false },
    'include-suspended':   { type: 'boolean', default: false },
    'allow-checksum-drift':{ type: 'boolean', default: false },
    'reconcile-ledger':    { type: 'boolean', default: false },
  },
});

// Either flag means "make no changes". --plan additionally reads tenant state
// to compute the true pending set; --dry-run does not.
const noWrite = args.plan || args['dry-run'];

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
    // Normalise EOL before hashing so the checksum is environment-independent
    // (a migration applied from a Windows CRLF checkout and one from CI/LF hash
    // the same). The normalised text is also what we apply — Postgres is
    // EOL-agnostic, so this is purely a determinism guarantee.
    const sql = (await readFile(join(MIGRATIONS_DIR, name), 'utf8')).replace(/\r\n/g, '\n');
    return { name, sql, checksum: sha256(sql) };
  })
);

log(`Loaded ${migrations.length} migration(s): ${migrationFiles.join(', ')}`);

// Canonical identity sets — the filename set is the source of truth for the
// ledger. CANON_BARES is the same set without the `.sql` suffix, used by the
// reconciler to recognise legacy un-suffixed rows.
const CANON_NAMES = new Set(migrations.map(m => m.name));
const CANON_BARES = new Set(migrations.map(m => m.name.replace(/\.sql$/, '')));

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
if (args.plan)        log('PLAN — read-only; reporting what would apply, changing nothing');
else if (args['dry-run']) log('DRY RUN — no migrations will be applied');

// ─── reconcile-ledger mode (one-time normaliser) ───────────────────────
// Runs INSTEAD of apply. Touches only app_data._eq_migrations — never schema or
// data. Gated behind the `production` environment in CI, same as apply.
if (args['reconcile-ledger']) {
  const recon = await mapWithConcurrency(routingRows, CONCURRENCY, reconcileLedgerForTenant);
  console.log('\n' + '━'.repeat(70));
  console.log(args['dry-run'] ? ' LEDGER RECONCILE — DRY RUN (no changes made)' : ' LEDGER RECONCILE — SUMMARY');
  console.log('━'.repeat(70));
  let anyReconFailed = false;
  for (const r of recon) {
    const tag = r.ok ? '✓' : '✗';
    console.log(` ${tag} ${r.slug.padEnd(20)} rename ${r.renamed.length}, stamp ${r.stamped.length}, dedupe ${r.dupDeleted.length}, drop-legacy ${r.legacyDeleted.length}, leave-pending ${r.pending.length}${r.error ? ' — ' + r.error : ''}`);
    if (args['dry-run']) {
      for (const x of r.renamed)       console.log(`     rename   ${x.from} -> ${x.to}`);
      for (const x of r.dupDeleted)    console.log(`     dedupe   ${x}`);
      for (const x of r.legacyDeleted) console.log(`     drop     ${x}`);
      for (const x of r.pending)       console.log(`     pending  ${x}  (a normal apply run will add this)`);
    }
    if (!r.ok) anyReconFailed = true;
  }
  console.log('━'.repeat(70));
  console.log(' Ledger reconcile touches only app_data._eq_migrations — no schema or data changed.');
  process.exit(anyReconFailed ? 2 : 0);
}

// ─── apply per-tenant (bounded concurrency) ────────────────────────────

const results = await mapWithConcurrency(routingRows, CONCURRENCY, applyMigrationsToTenant);

if (args.plan) {
  // Read-only matrix for the CI plan job. `applied` here means "WOULD apply".
  console.log('\n' + '━'.repeat(70));
  console.log(' MIGRATION PLAN — what a real run would apply (no changes made)');
  console.log('━'.repeat(70));
  let pendingTotal = 0;
  for (const r of results) {
    if (r.error) {
      console.log(` ✗ ${r.slug.padEnd(20)} could not read tenant — ${r.error}`);
    } else if (r.applied.length === 0) {
      console.log(` ✓ ${r.slug.padEnd(20)} up to date (${r.skipped.length} already applied)`);
    } else {
      pendingTotal += r.applied.length;
      console.log(` → ${r.slug.padEnd(20)} ${r.applied.length} pending: ${r.applied.join(', ')}`);
    }
    for (const w of r.warnings) console.log(`     ! ${w}`);
  }
  console.log('━'.repeat(70));
  console.log(pendingTotal === 0
    ? ' No pending migrations across the fleet.'
    : ` ${pendingTotal} migration application(s) pending across ${results.filter(r => r.applied.length).length} tenant(s).`);
  // Plan is informational: never fail the PR check on pending work or a read error.
  process.exit(0);
}

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
    if (!noWrite) {
      await mgmtQuery(ref, `
        CREATE SCHEMA IF NOT EXISTS app_data;
        CREATE TABLE IF NOT EXISTS app_data._eq_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now(),
          checksum text
        );
      `);
    }

    // --plan reads the REAL applied set (tolerating a not-yet-provisioned ledger
    // table) so the matrix is accurate. --dry-run keeps its historical behaviour
    // of treating every migration as a candidate. A real run loads + writes.
    const applied = args.plan      ? await loadAppliedTolerant(ref)
                  : args['dry-run'] ? new Map()
                  : await loadApplied(ref);

    for (const m of migrations) {
      if (applied.has(m.name)) {
        const recorded = applied.get(m.name);
        if (recorded == null) {
          // Legacy row with no checksum — can't verify drift. Backfill from disk
          // (assumes disk == applied, true for forward-only migrations) so future
          // runs CAN detect drift, and surface a warning that this run trusted it.
          result.warnings.push(`${m.name}: recorded without a checksum — backfilled from disk (drift not verifiable for this row)`);
          if (!noWrite) {
            await mgmtQuery(ref, `UPDATE app_data._eq_migrations SET checksum = ${sqlLiteral(m.checksum)} WHERE name = ${sqlLiteral(m.name)} AND checksum IS NULL;`);
          }
          result.skipped.push(m.name);
          continue;
        }
        if (recorded !== m.checksum && !args['allow-checksum-drift']) {
          // In plan mode, surface drift as a warning instead of throwing — the
          // plan job is informational and must never exit non-zero on a PR.
          if (args.plan) {
            result.warnings.push(`${m.name}: checksum drift (recorded ${recorded.slice(0, 12)}…, disk ${m.checksum.slice(0, 12)}…) — would FAIL a real run`);
            result.skipped.push(m.name);
            continue;
          }
          throw new Error(
            `checksum drift on ${m.name} (recorded ${recorded.slice(0, 12)}…, disk ${m.checksum.slice(0, 12)}…). ` +
            `The file changed after it was applied — author a new forward migration, or re-run with --allow-checksum-drift.`);
        }
        result.skipped.push(m.name);
        continue;
      }

      if (noWrite) { result.applied.push(m.name); continue; }
      log(`  [${slug}] applying ${m.name}…`);

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

// Reconcile ONE tenant's ledger to the canonical filename set. Writes only to
// app_data._eq_migrations, in a single transaction, and is idempotent (a second
// run produces no statements). Migrations the tenant has never recorded are left
// untouched (pending) — reconcile normalises bookkeeping, it does not apply SQL.
async function reconcileLedgerForTenant(routing) {
  const { ref, slug } = routing;
  const result = { slug, ok: false, renamed: [], stamped: [], dupDeleted: [], legacyDeleted: [], pending: [], error: null };
  const dryRun = args['dry-run'];

  try {
    if (!dryRun) {
      await mgmtQuery(ref, `
        CREATE SCHEMA IF NOT EXISTS app_data;
        CREATE TABLE IF NOT EXISTS app_data._eq_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now(),
          checksum text
        );
      `);
    }

    const current = await loadAppliedTolerant(ref);   // Map name -> checksum
    const stmts = [];

    for (const m of migrations) {
      const bare    = m.name.replace(/\.sql$/, '');
      const hasSql  = current.has(m.name);
      const hasBare = current.has(bare);

      if (hasSql && hasBare) {
        // Both variants recorded (the two-runners duplicate). Keep the .sql row
        // with the correct checksum; drop the bare twin.
        if (current.get(m.name) !== m.checksum) {
          stmts.push(`UPDATE app_data._eq_migrations SET checksum=${sqlLiteral(m.checksum)} WHERE name=${sqlLiteral(m.name)};`);
          result.stamped.push(m.name);
        }
        stmts.push(`DELETE FROM app_data._eq_migrations WHERE name=${sqlLiteral(bare)};`);
        result.dupDeleted.push(bare);
      } else if (hasSql && !hasBare) {
        // Canonical name already present — only (re)stamp if the checksum drifted
        // (e.g. a CRLF hash recorded by a Windows apply).
        if (current.get(m.name) !== m.checksum) {
          stmts.push(`UPDATE app_data._eq_migrations SET checksum=${sqlLiteral(m.checksum)} WHERE name=${sqlLiteral(m.name)};`);
          result.stamped.push(m.name);
        }
      } else if (!hasSql && hasBare) {
        // Legacy un-suffixed row — rename to the canonical filename + stamp.
        stmts.push(`UPDATE app_data._eq_migrations SET name=${sqlLiteral(m.name)}, checksum=${sqlLiteral(m.checksum)} WHERE name=${sqlLiteral(bare)};`);
        result.renamed.push({ from: bare, to: m.name });
      } else {
        // Never recorded in any form — a normal apply run will add it.
        result.pending.push(m.name);
      }
    }

    // Drop rows that match no canonical file (the out-of-band eq-intake lineage
    // 013…048, and any other stragglers). Their schema effects remain in the DB;
    // only the bookkeeping row goes.
    for (const name of current.keys()) {
      if (CANON_NAMES.has(name) || CANON_BARES.has(name)) continue;
      stmts.push(`DELETE FROM app_data._eq_migrations WHERE name=${sqlLiteral(name)};`);
      result.legacyDeleted.push(name);
    }

    if (!dryRun && stmts.length > 0) {
      await mgmtQuery(ref, 'BEGIN;\n' + stmts.join('\n') + '\nCOMMIT;');
      log(`  [${slug}] reconciled: ${stmts.length} ledger statement(s)`);
    }
    result.ok = true;
  } catch (err) {
    result.error = err?.message ?? String(err);
    log(`  [${slug}] ✗ reconcile failed: ${result.error}`);
  }
  return result;
}

async function loadApplied(ref) {
  const rows = await mgmtRows(ref, `SELECT name, checksum FROM app_data._eq_migrations;`);
  return new Map(rows.map(r => [r.name, r.checksum]));
}

// Plan mode never writes, so it can't bootstrap the ledger table. A freshly
// provisioned tenant won't have app_data._eq_migrations yet — referencing it
// directly would error. Probe with to_regclass first and treat "absent" as
// "nothing applied" so the plan shows the full migration set as pending.
async function loadAppliedTolerant(ref) {
  const exists = (await mgmtRows(ref,
    `SELECT to_regclass('app_data._eq_migrations') IS NOT NULL AS present;`))[0]?.present;
  return exists ? loadApplied(ref) : new Map();
}

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function fail(code, msg) { console.error(`ERROR: ${msg}`); process.exit(code); }
