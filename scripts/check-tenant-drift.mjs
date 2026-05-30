#!/usr/bin/env node
// scripts/check-tenant-drift.mjs
//
// The enforced no-drift gate for the per-tenant canonical data plane.
//
// ARCHITECTURE-V2 principle 4 ("drift between tenants is not tolerated") was
// asserted but never enforced — which is how `core` and `sks` diverged. This is
// the enforcement: it introspects the ACTUAL schema of every active tenant
// (app_data tables + columns, app_data/public functions incl. SECURITY DEFINER +
// search_path, app_data RLS policies incl. predicate) and fails if any tenant
// differs from the reference. It trusts reality, not the _eq_migrations ledger
// (which has lied — null checksums, missing rows).
//
// Because the fingerprint includes function `secdef`/`search_path` and policy
// `qual`, this also catches the security regressions we found (anon-exec funcs,
// `USING (true)` policies, `user_metadata` RLS) — not just structural drift.
//
// Both the tenant lookup and the per-tenant fingerprint go through the Supabase
// Management API (scripts/_mgmt.mjs) — same env contract as migrate-tenants.mjs.
//
// Usage:
//   node scripts/check-tenant-drift.mjs                  # compare all active tenants
//   node scripts/check-tenant-drift.mjs --reference=core # pin the reference tenant
//   node scripts/check-tenant-drift.mjs --json           # machine-readable diff
//
// Required env:
//   SUPABASE_ACCESS_TOKEN   Management API token (personal/org)
//   CONTROL_PROJECT_REF     Control-plane project ref (falls back to CONTROL_SUPABASE_URL)
//
// Exit codes: 0 = no drift, 1 = config error, 2 = drift detected.

import { parseArgs } from 'node:util';
import { mgmtRows, loadActiveTenants, requireAccessToken } from './_mgmt.mjs';

const { values: args } = parseArgs({ options: {
  reference: { type: 'string' },
  json:      { type: 'boolean', default: false },
}});

requireAccessToken();   // fail fast on missing token

// One query returns this tenant's full schema fingerprint as sorted JSON arrays,
// so cosmetic ordering never registers as drift. Public functions are scoped to
// our own canonical naming (eq_/_eq_) + exec_sql, to avoid flagging differences in
// Supabase/extension-provided functions. Tenant-SPECIFIC overlays (e.g. sks_*) are
// deliberately out of scope for this CROSS-tenant gate — they live in per-app /
// per-tenant tracks and would otherwise always read as drift. exec_sql appearing
// here is itself a finding until it's dropped from every tenant.
const FINGERPRINT_SQL = `
  select jsonb_build_object(
    'tables', (
      select coalesce(jsonb_agg(tablename order by tablename), '[]'::jsonb)
      from pg_tables where schemaname = 'app_data'
    ),
    'columns', (
      select coalesce(jsonb_agg(sig order by sig), '[]'::jsonb) from (
        select table_name || '.' || column_name || ' ' || data_type
               || case when is_nullable = 'NO' then ' NOT NULL' else '' end as sig
        from information_schema.columns
        where table_schema = 'app_data'
      ) c
    ),
    'functions', (
      select coalesce(jsonb_agg(sig order by sig), '[]'::jsonb) from (
        select n.nspname || '.' || p.proname
               || '(' || pg_get_function_identity_arguments(p.oid) || ')'
               || ' secdef=' || p.prosecdef
               || ' search_path=' || coalesce(array_to_string(p.proconfig, ','), '(none)') as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prokind = 'f'
          and ( n.nspname = 'app_data'
             or ( n.nspname = 'public'
                  and ( p.proname ~ '^_?eq_' or p.proname = 'exec_sql' ) ) )
      ) f
    ),
    'policies', (
      select coalesce(jsonb_agg(sig order by sig), '[]'::jsonb) from (
        select tablename || '.' || policyname || ' ' || cmd
               || ' USING ' || coalesce(qual, '-') as sig
        from pg_policies where schemaname = 'app_data'
      ) pol
    )
  ) as fp;
`;

async function fingerprint(ref) {
  const rows = await mgmtRows(ref, FINGERPRINT_SQL);
  return rows?.[0]?.fp ?? { tables: [], columns: [], functions: [], policies: [] };
}

// ── load active tenants ──
let tenants;
try {
  tenants = await loadActiveTenants();   // [{ slug, ref, status }]
} catch (e) {
  fail(1, `tenant lookup failed: ${e.message}`);
}
if (!tenants.length) fail(1, 'no active tenants in tenant_routing');

// ── fingerprint every tenant ──
const fps = {};
for (const t of tenants) {
  fps[t.slug] = await fingerprint(t.ref);
  log(`fingerprinted ${t.slug} (${t.ref})`);
}

// ── compare against the reference ──
const refSlug = args.reference ?? tenants[0].slug;
if (!fps[refSlug]) fail(1, `reference '${refSlug}' not among ${tenants.map(t => t.slug).join(', ')}`);

const CATS = ['tables', 'columns', 'functions', 'policies'];
const report = {};
let drift = false;

for (const t of tenants) {
  if (t.slug === refSlug) continue;
  const cats = {};
  for (const cat of CATS) {
    const refSet = new Set(fps[refSlug][cat]);
    const curSet = new Set(fps[t.slug][cat]);
    const missing = [...refSet].filter(x => !curSet.has(x));  // in reference, absent here
    const extra   = [...curSet].filter(x => !refSet.has(x));  // here, absent from reference
    if (missing.length || extra.length) { drift = true; cats[cat] = { missing, extra }; }
  }
  if (Object.keys(cats).length) report[t.slug] = cats;
}

if (args.json) {
  console.log(JSON.stringify({ reference: refSlug, drift, report }, null, 2));
} else if (!drift) {
  console.log(`\n✓ No drift — every tenant matches '${refSlug}'.`);
} else {
  console.log(`\nReference tenant: ${refSlug}`);
  for (const [slug, cats] of Object.entries(report)) {
    console.log(`\n✗ ${slug} differs:`);
    for (const [cat, diff] of Object.entries(cats)) {
      for (const m of diff.missing) console.log(`    - [${cat}] MISSING here: ${m}`);
      for (const e of diff.extra)   console.log(`    + [${cat}] EXTRA here:   ${e}`);
    }
  }
}

process.exit(drift ? 2 : 0);

// ── helpers ──
function log(m) { console.log(`[drift] ${m}`); }
function fail(code, m) { console.error(`ERROR: ${m}`); process.exit(code); }
