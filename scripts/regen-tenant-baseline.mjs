#!/usr/bin/env node
// scripts/regen-tenant-baseline.mjs
//
// Introspects shared eq-canonical's app_data schema and emits a tenant-plane
// migration file containing every table not already covered by 0001_baseline.
//
// Output: supabase/tenant-migrations/<NNNN>_<name>.sql with:
//   - CREATE TABLE IF NOT EXISTS (exact column shape, types, defaults, NOT NULL)
//   - PRIMARY KEY + UNIQUE + CHECK constraints
//   - FOREIGN KEYs (deferred to a second pass so creation order doesn't matter)
//   - All indexes (via pg_get_indexdef)
//   - GRANTs for service_role
//   - RLS enable + tenant_isolation policy (service-role-only tables get RLS
//     on with NO policy — see SERVICE_ROLE_ONLY)
//   - updated_at trigger where the column exists
//
// We use pg_get_constraintdef + pg_get_indexdef so DDL strings come straight
// from Postgres — no reinventing of type/default formatting that drifts.
//
// Usage:
//   node scripts/regen-tenant-baseline.mjs \
//     --output=supabase/tenant-migrations/0002_remaining_tables.sql \
//     --exclude=customers,contacts,sites,staff,licences,jobs,canonical_events,_eq_migrations
//
// Required env vars:
//   SHARED_SUPABASE_URL          shared eq-canonical URL
//   SHARED_SUPABASE_SERVICE_KEY  shared eq-canonical service-role key

import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

// Reserved-word + quoting helper. Declared at module top because top-level
// await downstream calls quote() before reaching the constant if it lives
// at the bottom (TDZ trap).
const PG_RESERVED = new Set([
  'all','analyse','analyze','and','any','array','as','asc','asymmetric',
  'authorization','binary','both','case','cast','check','collate','collation',
  'column','concurrently','constraint','create','cross','current_catalog',
  'current_date','current_role','current_schema','current_time',
  'current_timestamp','current_user','default','deferrable','desc','distinct',
  'do','else','end','except','false','fetch','for','foreign','freeze','from',
  'full','grant','group','having','ilike','in','initially','inner','intersect',
  'into','is','isnull','join','lateral','leading','left','like','limit',
  'localtime','localtimestamp','natural','not','notnull','null','offset','on',
  'only','or','order','outer','overlaps','placing','primary','references',
  'returning','right','select','session_user','similar','some','symmetric',
  'table','tablesample','then','to','trailing','true','union','unique','user',
  'using','variadic','verbose','when','where','window','with',
  'position','type',
]);

function quote(name) {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !PG_RESERVED.has(name) ? name : `"${name}"`;
}

// Service-role-only tables: written/read ONLY by service_role (migration scripts,
// SECURITY DEFINER reconcile functions) with no browser path. These get RLS on
// but NO caller-scoped tenant_isolation policy — even though they have a
// tenant_id column — because service_role bypasses RLS and anon/authenticated
// must have no access at all. Emitting a tenant_isolation policy here would
// re-introduce the exact spine drift fixed in tenant-migration 0039
// (migration_baseline diverged because a regen pass kept re-adding the policy).
// Keep this list in sync with the migrations that set the same posture AND with
// SERVICE_ROLE_ONLY in scripts/check-tenant-drift.mjs (the CI invariant).
// _eq_migrations is the ledger table — same posture; it is normally in --exclude
// so regen won't emit it, but it is listed here so the two lists stay identical.
const SERVICE_ROLE_ONLY = new Set([
  'migration_baseline',
  '_eq_migrations',
]);

const { values: args } = parseArgs({
  options: {
    output:  { type: 'string' },
    exclude: { type: 'string', default: '' },
    schema:  { type: 'string', default: 'app_data' },
    name:    { type: 'string', default: '0002_remaining_tables' },
  },
});

if (!args.output) { console.error('--output=<path> required'); process.exit(1); }
const env = requireEnvs(['SHARED_SUPABASE_URL', 'SHARED_SUPABASE_SERVICE_KEY']);
const exclude = new Set(args.exclude.split(',').map(s => s.trim()).filter(Boolean));

const sb = createClient(env.SHARED_SUPABASE_URL, env.SHARED_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Bootstrap an exec_sql RPC if shared eq-canonical doesn't already expose one.
// We need it because supabase-js' .from()/.select() can't introspect pg_catalog.
// One-time setup; idempotent.
async function execSql(sql) {
  const url = `${env.SHARED_SUPABASE_URL}/rest/v1/rpc/_eq_introspect`;
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':        env.SHARED_SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SHARED_SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  if (res.status === 404) {
    // Bootstrap (security-definer; service-role only since we revoke from PUBLIC).
    // Run via Supabase /pg/meta — fallback: use exec_sql if it exists.
    throw new Error('No _eq_introspect RPC on shared eq-canonical. Create it once via Supabase SQL editor:\n\n' +
`CREATE OR REPLACE FUNCTION public._eq_introspect(sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r jsonb;
BEGIN
  EXECUTE 'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (' || sql || ') t' INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public._eq_introspect(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._eq_introspect(text) TO service_role;`);
  }
  if (!res.ok) {
    throw new Error(`exec_sql failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// Helper: SELECT and return rows.
async function q(sql) {
  const rows = await execSql(sql);
  return Array.isArray(rows) ? rows : [];
}

log(`Introspecting ${args.schema}...`);

const tables = (await q(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = '${args.schema}' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`))
  .map(r => r.table_name)
  .filter(name => !exclude.has(name));

log(`Tables to emit: ${tables.length} (excluded ${exclude.size})`);

const parts = [];
parts.push(headerComment(args.name, tables));
parts.push('BEGIN;\n');
// Search-path so unqualified FK refs (e.g. REFERENCES staff(staff_id))
// resolve to app_data.staff. pg_get_constraintdef returns unqualified names
// when the table is in the current schema at creation time.
parts.push("SET LOCAL search_path = app_data, public;\n");

// Pass 1: CREATE TABLE (no FKs — those go in pass 2)
for (const t of tables) {
  parts.push(await emitCreateTable(args.schema, t));
}

// Pass 2: FK constraints
parts.push('\n-- Foreign keys (added after all tables created so order is moot)\n');
for (const t of tables) {
  parts.push(await emitForeignKeys(args.schema, t));
}

// Pass 3: Indexes
parts.push('\n-- Indexes\n');
for (const t of tables) {
  parts.push(await emitIndexes(args.schema, t));
}

// Pass 4: RLS + grants + tenant policy + updated_at trigger
parts.push('\n-- Grants, RLS, tenant isolation, updated_at trigger\n');
for (const t of tables) {
  parts.push(emitGrantsAndPolicies(args.schema, t));
}

parts.push(`\nINSERT INTO app_data._eq_migrations(name, checksum) VALUES ('${args.name}', NULL)\n  ON CONFLICT (name) DO NOTHING;\n`);
parts.push('COMMIT;\n');

const sql = parts.join('\n');
await writeFile(args.output, sql, 'utf8');
log(`Wrote ${sql.length.toLocaleString()} chars to ${args.output}`);
log(`Next: apply via Supabase MCP apply_migration, then extend sync-tenant-data.mjs PLAN.`);

// ──────────────────────────────────────────────────────────────────────
// Per-pass builders
// ──────────────────────────────────────────────────────────────────────

async function emitCreateTable(schema, table) {
  const cols = await q(`
    SELECT a.attname AS name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS notnull,
           pg_get_expr(ad.adbin, ad.adrelid) AS default_expr
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = '${schema}.${table}'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `);
  const constraints = await q(`
    SELECT conname AS name, pg_get_constraintdef(c.oid) AS def, c.contype AS type
    FROM pg_constraint c
    JOIN pg_class cls ON cls.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = '${schema}' AND cls.relname = '${table}'
      AND c.contype IN ('p','u','c')   -- pk, unique, check (not fk — pass 2)
    ORDER BY c.contype, c.conname
  `);

  const colDefs = cols.map(c => {
    let def = `  ${quote(c.name)} ${c.type}`;
    if (c.notnull) def += ' NOT NULL';
    if (c.default_expr) def += ` DEFAULT ${c.default_expr}`;
    return def;
  });
  const constraintDefs = constraints.map(c => `  CONSTRAINT ${quote(c.name)} ${c.def}`);

  return `CREATE TABLE IF NOT EXISTS ${schema}.${table} (\n` +
         [...colDefs, ...constraintDefs].join(',\n') +
         '\n);\n';
}

async function emitForeignKeys(schema, table) {
  // Only emit FKs whose TARGET table is also in the same schema. Cross-schema
  // FKs (e.g. app_data.*.mentor_user_id → shell_control.users.id) can't
  // exist in tenant DBs because the control-plane tables aren't there.
  // Those become soft references — application enforces, Postgres doesn't.
  const fks = await q(`
    SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class cls ON cls.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    JOIN pg_class fcls ON fcls.oid = c.confrelid
    JOIN pg_namespace fn ON fn.oid = fcls.relnamespace
    WHERE n.nspname = '${schema}' AND cls.relname = '${table}'
      AND c.contype = 'f'
      AND fn.nspname = '${schema}'
    ORDER BY c.conname
  `);
  if (fks.length === 0) return '';

  return fks.map(c =>
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${c.name}' AND conrelid = '${schema}.${table}'::regclass) THEN
        ALTER TABLE ${schema}.${table} ADD CONSTRAINT ${quote(c.name)} ${c.def};
      END IF;
    END $$;`
  ).join('\n') + '\n';
}

async function emitIndexes(schema, table) {
  const idxs = await q(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = '${schema}' AND tablename = '${table}'
      -- Skip indexes auto-created for PK/UNIQUE constraints (named same as constraint)
      AND indexname NOT IN (
        SELECT conname FROM pg_constraint c
        JOIN pg_class cls ON cls.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cls.relnamespace
        WHERE n.nspname = '${schema}' AND cls.relname = '${table}' AND c.contype IN ('p','u')
      )
    ORDER BY indexname
  `);
  if (idxs.length === 0) return '';
  // pg_get_indexdef returns "CREATE INDEX ..." — convert to IF NOT EXISTS.
  return idxs.map(i =>
    i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ')
  ).join(';\n') + ';\n';
}

function emitGrantsAndPolicies(schema, table) {
  // Service-role-only tables: RLS on, NO caller-scoped policy. service_role
  // bypasses RLS; anon/authenticated get no grant and no row access. Drop any
  // stray tenant_isolation policy a previous regen may have emitted.
  if (SERVICE_ROLE_ONLY.has(table)) {
    return `GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.${table} TO service_role;
REVOKE ALL ON ${schema}.${table} FROM PUBLIC, anon, authenticated;
ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- service-role-only (see SERVICE_ROLE_ONLY): no caller-scoped policy.
  EXECUTE 'DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${schema}.${table}';
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}' AND column_name='updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS ${table}_touch_updated_at ON ${schema}.${table}';
    EXECUTE 'CREATE TRIGGER ${table}_touch_updated_at BEFORE UPDATE ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION app_data.touch_updated_at()';
  END IF;
END $$;
`;
  }

  return `GRANT ALL ON ${schema}.${table} TO service_role;
ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}' AND column_name='tenant_id') THEN
    EXECUTE 'DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${schema}.${table}';
    EXECUTE 'CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} FOR ALL TO authenticated USING (tenant_id = ((auth.jwt() -> ''app_metadata'' ->> ''tenant_id''))::uuid) WITH CHECK (tenant_id = ((auth.jwt() -> ''app_metadata'' ->> ''tenant_id''))::uuid)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}' AND column_name='updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS ${table}_touch_updated_at ON ${schema}.${table}';
    EXECUTE 'CREATE TRIGGER ${table}_touch_updated_at BEFORE UPDATE ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION app_data.touch_updated_at()';
  END IF;
END $$;
`;
}

// ──────────────────────────────────────────────────────────────────────
function headerComment(name, tables) {
  return `-- Migration: ${name}
-- Target:    Per-tenant data plane
-- Purpose:   Tables not covered by 0001_baseline. Schema mirrors shared
--            eq-canonical app_data so pg_dump → restore (or upsert sync)
--            preserves all rows.
--
-- Generated by scripts/regen-tenant-baseline.mjs against shared eq-canonical
-- on ${new Date().toISOString()}.
--
-- Tables (${tables.length}):
${tables.map(t => `--   ${t}`).join('\n')}
--
-- All tables: GRANT to service_role, RLS enabled with tenant_isolation
-- policy (if tenant_id column exists), updated_at trigger (if column exists).
-- Service-role-only tables (e.g. migration_baseline) get RLS on with NO
-- caller-scoped policy — service_role bypasses RLS, no anon/authenticated path.
`;
}

function requireEnvs(names) {
  const out = {}; const missing = [];
  for (const n of names) { const v = process.env[n]; if (!v) missing.push(n); else out[n] = v; }
  if (missing.length) { console.error(`Missing env: ${missing.join(', ')}`); process.exit(1); }
  return out;
}
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
