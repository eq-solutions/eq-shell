#!/usr/bin/env node
// scripts/migrate-tenants.mjs
//
// Apply every pending tenant-plane migration (supabase/tenant-migrations/*.sql)
// to every tenant data plane.
//
// Reads shell_control.tenant_routing, decrypts each service-role key, opens
// a Supabase client against the tenant DB, ensures app_data._eq_migrations
// exists, and applies anything missing in order.
//
// Idempotent — safe to re-run any time. Migrations that have already been
// applied (by filename) are skipped. To re-apply, delete the row from
// app_data._eq_migrations in the target tenant DB by hand.
//
// Usage:
//   node scripts/migrate-tenants.mjs                # all tenants (provisioning + active)
//   node scripts/migrate-tenants.mjs --slug=core    # just one tenant
//   node scripts/migrate-tenants.mjs --dry-run      # show what would run, do nothing
//   node scripts/migrate-tenants.mjs --include-suspended   # include suspended tenants (rare)
//
// Required env vars:
//   CONTROL_SUPABASE_URL           URL of the control-plane Supabase
//   CONTROL_SUPABASE_SERVICE_KEY   Service-role key for control plane
//   TENANT_ROUTING_MASTER_KEY      Same value set in eq-shell Netlify env
//
// Exit codes: 0 = all migrations applied, 1 = config error, 2 = at least one tenant failed.
//
// Concurrency: migrations run sequentially per tenant; tenants run in parallel
// with a small concurrency limit (CONCURRENCY=3) to avoid hammering the
// Management API or Supabase rate limits.

import { createClient } from '@supabase/supabase-js';
import { createDecipheriv, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'tenant-migrations');

const CONCURRENCY = 3;

// ─── args + env ────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    slug:                  { type: 'string' },
    'dry-run':             { type: 'boolean', default: false },
    'include-suspended':   { type: 'boolean', default: false },
  },
});

const env = requireEnvs([
  'CONTROL_SUPABASE_URL',
  'CONTROL_SUPABASE_SERVICE_KEY',
  'TENANT_ROUTING_MASTER_KEY',
]);
const masterKey = validateMasterKey(env.TENANT_ROUTING_MASTER_KEY);

const control = createClient(env.CONTROL_SUPABASE_URL, env.CONTROL_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db:   { schema: 'shell_control' },
});

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

// ─── load tenants ──────────────────────────────────────────────────────

const statuses = args['include-suspended']
  ? ['provisioning', 'active', 'suspended']
  : ['provisioning', 'active'];

let routingQuery = control
  .from('tenant_routing')
  .select(`
    tenant_id,
    supabase_url,
    supabase_project_ref,
    service_role_key_ciphertext,
    service_role_key_iv,
    service_role_key_tag,
    status,
    tenants!inner ( slug, name )
  `)
  .in('status', statuses);

if (args.slug) routingQuery = routingQuery.eq('tenants.slug', args.slug);

const { data: routings, error: routingErr } = await routingQuery;
if (routingErr) fail(1, `tenant_routing query failed: ${routingErr.message}`);
if (!routings || routings.length === 0) {
  log(args.slug
    ? `No tenant routing found for slug='${args.slug}' (status in ${statuses.join('|')})`
    : `No tenants in tenant_routing with status in ${statuses.join('|')}`);
  process.exit(0);
}

log(`Targets: ${routings.map(r => `${r.tenants.slug} (${r.status})`).join(', ')}`);
if (args['dry-run']) log('DRY RUN — no migrations will be applied');

// ─── apply per-tenant (with concurrency) ───────────────────────────────

const results = await runWithConcurrency(routings, CONCURRENCY, applyMigrationsToTenant);

console.log('');
console.log('━'.repeat(70));
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
  const slug = routing.tenants.slug;
  const result = { slug, ok: false, applied: [], skipped: [], error: null };

  try {
    const serviceKey = decryptSecret({
      ciphertext: routing.service_role_key_ciphertext,
      iv:         routing.service_role_key_iv,
      tag:        routing.service_role_key_tag,
    });

    const tenantClient = createClient(routing.supabase_url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Ensure tracking table exists.
    if (!args['dry-run']) {
      await execSql(tenantClient, `
        CREATE SCHEMA IF NOT EXISTS app_data;
        CREATE TABLE IF NOT EXISTS app_data._eq_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now(),
          checksum text
        );
      `);
    }

    const applied = args['dry-run']
      ? new Set()
      : await loadApplied(tenantClient);

    for (const m of migrations) {
      if (applied.has(m.name)) {
        result.skipped.push(m.name);
        continue;
      }
      log(`  [${slug}] applying ${m.name}...`);
      if (args['dry-run']) {
        result.applied.push(m.name);
        continue;
      }
      await execSql(tenantClient, m.sql);
      await execSql(tenantClient, `
        INSERT INTO app_data._eq_migrations(name, checksum)
        VALUES ($name$${m.name}$name$, $cs$${m.checksum}$cs$)
        ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum;
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

async function loadApplied(client) {
  // Use RPC if available; fall back to a raw SELECT via the REST layer.
  const { data, error } = await client
    .schema('app_data')
    .from('_eq_migrations')
    .select('name');
  if (error) throw new Error(`load _eq_migrations: ${error.message}`);
  return new Set((data ?? []).map(r => r.name));
}

// Execute a multi-statement SQL block via Postgres-meta-style RPC if the
// project has one; else fall back to splitting (best-effort).
//
// Supabase projects don't expose raw EXEC by default. We rely on the
// platform's pg_meta extension being available — every project has it.
// Calls to /pg-meta/<ref>/query require the service-role JWT.
async function execSql(client, sql) {
  // The supabase-js client doesn't expose pg_meta directly; use fetch.
  const baseUrl = client.supabaseUrl;
  const serviceKey = client.supabaseKey;
  const url = `${baseUrl}/rest/v1/rpc/exec_sql`;

  // Prefer a project-defined exec_sql RPC if present (cleanest).
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':         serviceKey,
      'Authorization':  `Bearer ${serviceKey}`,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  if (res.status === 404) {
    // Fall back to creating exec_sql on first call (idempotent).
    await bootstrapExecSql(client);
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey':         serviceKey,
        'Authorization':  `Bearer ${serviceKey}`,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ sql }),
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`exec_sql failed (${res.status}): ${text}`);
  }
}

// Bootstrap a service-role-only exec_sql RPC on the tenant DB so the
// runner can apply arbitrary DDL. This is created via the Supabase admin
// SQL endpoint (pg_meta), which is gated by the service-role key.
async function bootstrapExecSql(client) {
  const ref = new URL(client.supabaseUrl).host.split('.')[0];
  const url = `${client.supabaseUrl}/pg/query`;
  const sql = `
    CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE sql;
    END;
    $$;
    REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
  `;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':         client.supabaseKey,
      'Authorization':  `Bearer ${client.supabaseKey}`,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`bootstrap exec_sql failed (${res.status}): ${text}\n\n` +
      `Tip: open Supabase dashboard → SQL editor for project '${ref}', paste the body of bootstrapExecSql, run once.`);
  }
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

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

async function runWithConcurrency(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
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
