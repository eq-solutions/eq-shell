#!/usr/bin/env node
// scripts/check-tenant-drift.mjs
//
// Three independent checks in one gate:
//
//   1. CROSS-TENANT DRIFT  — fingerprints app_data schema (tables, columns,
//      functions, policies) across every active tenant and fails if any tenant
//      differs from the reference. Catches structural drift AND security
//      regressions (anon-exec fns, USING(true) policies, user_metadata RLS).
//
//   2. ANON-GRANT INVARIANT — scans all three canonical Supabase projects for
//      tables reachable by the anon or authenticated role with no caller-scoped
//      RLS policy. This caught the 2026-05-31 sks-canonical open door (13
//      sks_quotes_* tables readable/writable by anyone with the anon key). Runs
//      against fixed infrastructure projects, not just active-tenant app_data.
//
//   3. MIGRATION IDENTITY  — compares supabase/tenant-migrations/*.sql repo
//      files against the _eq_migrations table on each data-plane tenant
//      (zaap = EQ, ehow = SKS) independently. The two tenants do NOT share a
//      migration lineage — same number can mean different content on each.
//      Reports: repo files not applied on a tenant (gaps) and migrations
//      applied on a tenant with no matching repo file (out-of-band).
//
// Usage:
//   node scripts/check-tenant-drift.mjs                  # all three checks
//   node scripts/check-tenant-drift.mjs --reference=core # pin drift reference
//   node scripts/check-tenant-drift.mjs --anon-only      # skip cross-tenant drift
//   node scripts/check-tenant-drift.mjs --no-anon        # skip anon-grant check
//   node scripts/check-tenant-drift.mjs --json           # machine-readable output
//
// Required env:
//   SUPABASE_ACCESS_TOKEN            Management API token
//   CONTROL_PROJECT_REF              Control-plane ref (jvknxcmbtrfnxfrwfimn)
//   CANONICAL_INTERNAL_PROJECT_REF   EQ internal tenant ref (zaapmfdkgedqupfjtchl)
//   SKS_CANONICAL_PROJECT_REF        SKS tenant ref (ehowgjardagevnrluult)
//
// Exit codes: 0 = all clear, 1 = config error, 2 = drift or violation detected.

import { parseArgs } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mgmtRows, controlRef, requireAccessToken } from './_mgmt.mjs';

const { values: args } = parseArgs({ options: {
  reference:  { type: 'string' },
  json:       { type: 'boolean', default: false },
  'anon-only':{ type: 'boolean', default: false },
  'no-anon':  { type: 'boolean', default: false },
}});

requireAccessToken();

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 1 — Cross-tenant app_data drift
// ═══════════════════════════════════════════════════════════════════════════

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

// ─── load tenants ───────────────────────────────────────────────────────────
// Lazy import so --anon-only skips the control-plane tenant lookup.
async function loadActiveTenants() {
  const { loadActiveTenants: load } = await import('./_mgmt.mjs');
  return load();
}

let driftResult = { skip: false, drift: false, report: {}, refSlug: '' };

if (!args['anon-only']) {
  let tenants;
  try {
    tenants = await loadActiveTenants();
  } catch (e) {
    fail(1, `tenant lookup failed: ${e.message}`);
  }
  if (!tenants.length) fail(1, 'no active tenants in tenant_routing');

  const fps = {};
  for (const t of tenants) {
    fps[t.slug] = await fingerprint(t.ref);
    log(`fingerprinted ${t.slug} (${t.ref})`);
  }

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
      const missing = [...refSet].filter(x => !curSet.has(x));
      const extra   = [...curSet].filter(x => !refSet.has(x));
      if (missing.length || extra.length) { drift = true; cats[cat] = { missing, extra }; }
    }
    if (Object.keys(cats).length) report[t.slug] = cats;
  }

  driftResult = { skip: false, drift, report, refSlug };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 2 — Anon-grant invariant (all three canonical projects)
// ═══════════════════════════════════════════════════════════════════════════

// Tables that intentionally allow anon reads for pre-auth bootstrap (login page,
// org lookup, schema registry). Only on the control plane (jvkn). Do NOT add
// entries here for data tables — bootstrap reads belong in service_role functions.
const INTENTIONAL_ANON_READS = {
  jvknxcmbtrfnxfrwfimn: new Set([
    'public.organisations',
    'public.module_entitlements',
    'shell_control.eq_schema_registry',
  ]),
};

// Returns rows: { grantee, table_schema, table_name, privileges, rls_enabled, open_policy_count }
//
// A grant to anon/authenticated is only *reachable* — and therefore a real
// exposure — if either:
//   • RLS is disabled on the table (grants apply directly), or
//   • a PERMISSIVE policy applies to the grantee (or `public`) whose gating
//     expression is the bare literal `true`, i.e. unconditional.
// Predicates that reference auth.uid()/auth.jwt() evaluate to NULL → deny for
// an anon request (no JWT), so an identity-gated policy is NOT reachable and
// must not be flagged. open_policy_count counts unconditional policies on the
// USING side (SELECT/UPDATE/DELETE/ALL) and the WITH CHECK side (INSERT/UPDATE/
// ALL). Supabase-managed platform schemas are excluded.
const ANON_GRANT_SQL = `
  SELECT
    rtg.grantee,
    rtg.table_schema,
    rtg.table_name,
    array_to_string(array_agg(DISTINCT rtg.privilege_type ORDER BY rtg.privilege_type), ',') AS privileges,
    bool_or(c.relrowsecurity) AS rls_enabled,
    (
      SELECT count(*)::int
      FROM pg_policies p
      WHERE p.schemaname = rtg.table_schema
        AND p.tablename  = rtg.table_name
        AND p.permissive = 'PERMISSIVE'
        AND (p.roles @> ARRAY[rtg.grantee]::name[] OR p.roles @> ARRAY['public']::name[])
        AND (
          (p.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND trim(coalesce(p.qual, '')) = 'true')
          OR (p.cmd IN ('INSERT','UPDATE','ALL') AND trim(coalesce(p.with_check, '')) = 'true')
        )
    ) AS open_policy_count
  FROM information_schema.role_table_grants rtg
  JOIN pg_namespace n ON n.nspname = rtg.table_schema
  JOIN pg_class c     ON c.relname = rtg.table_name AND c.relnamespace = n.oid
  WHERE rtg.grantee IN ('anon', 'authenticated')
    AND rtg.table_schema NOT IN (
      'pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1',
      'realtime', 'storage', 'vault', 'graphql', 'graphql_public', 'pgsodium',
      'pgbouncer', 'cron', 'net', 'supabase_functions', 'supabase_migrations',
      'extensions', '_realtime', '_analytics'
    )
  GROUP BY rtg.grantee, rtg.table_schema, rtg.table_name
  HAVING count(*) > 0
  ORDER BY rtg.table_schema, rtg.table_name, rtg.grantee;
`;

async function checkAnonGrants(ref, label) {
  let rows;
  try {
    rows = await mgmtRows(ref, ANON_GRANT_SQL);
  } catch (e) {
    return { ref, label, error: e.message, violations: [], intentional: [] };
  }

  const exclusions = INTENTIONAL_ANON_READS[ref] ?? new Set();
  const violations = [];
  const intentional = [];

  for (const row of rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    // Reachable by this grantee = RLS off (grants apply directly) OR an
    // unconditional permissive policy exists. Identity-gated policies are not
    // reachable by an anon request, so they are intentionally not flagged.
    const reachable = row.rls_enabled === false || row.open_policy_count > 0;
    if (!reachable) continue;
    row.reason = row.rls_enabled === false ? 'rls-disabled' : 'open-policy';
    if (exclusions.has(key)) {
      // Deliberate, documented bootstrap reads (login page org lookup, etc.).
      intentional.push({ ...row, key });
      continue;
    }
    violations.push({ ...row, key });
  }

  return { ref, label, violations, intentional };
}

const CANONICAL_PROJECTS = [
  {
    envKey: 'CONTROL_PROJECT_REF',
    ref: process.env.CONTROL_PROJECT_REF ?? controlRef(),
    label: 'eq-canonical (control plane)',
  },
  {
    envKey: 'CANONICAL_INTERNAL_PROJECT_REF',
    ref: process.env.CANONICAL_INTERNAL_PROJECT_REF,
    label: 'eq-canonical-internal (EQ tenant)',
  },
  {
    envKey: 'SKS_CANONICAL_PROJECT_REF',
    ref: process.env.SKS_CANONICAL_PROJECT_REF,
    label: 'sks-canonical (SKS tenant)',
  },
];

let anonResults = [];
let anonFailed = false;

if (!args['no-anon']) {
  log('');
  log('running anon-grant invariant check …');
  for (const proj of CANONICAL_PROJECTS) {
    if (!proj.ref) {
      log(`  skipping ${proj.label} — ${proj.envKey} not set`);
      continue;
    }
    const result = await checkAnonGrants(proj.ref, proj.label);
    anonResults.push(result);
    if (result.error) {
      log(`  error querying ${proj.label}: ${result.error}`);
      anonFailed = true;
    } else if (result.violations.length) {
      anonFailed = true;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 3 — Migration identity (repo files vs applied per tenant)
// ═══════════════════════════════════════════════════════════════════════════
//
// The two tenants (zaap = EQ, ehow = SKS) have DIVERGED migration histories.
// The same migration number may represent entirely different content on each
// tenant (e.g. 0018 = dashboard_counts_asset on zaap, gm_reports on ehow).
// This check does NOT compare tenants against each other — it compares each
// tenant independently against the canonical repo file list.
//
// Source of truth: supabase/tenant-migrations/*.sql (filename-sorted).
// Applied record:  _eq_migrations table on each tenant (queried via mgmt API).
//
// Each tenant's _eq_migrations table may contain entries keyed by either the
// full filename (post-2026-05-30 runner) or the basename without .sql (old
// runner). Both are normalised to the full filename for comparison.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'tenant-migrations');

const TENANT_DATA_PLANES = [
  {
    envKey: 'CANONICAL_INTERNAL_PROJECT_REF',
    ref: process.env.CANONICAL_INTERNAL_PROJECT_REF,
    label: 'zaap (EQ · zaapmfdkgedqupfjtchl)',
  },
  {
    envKey: 'SKS_CANONICAL_PROJECT_REF',
    ref: process.env.SKS_CANONICAL_PROJECT_REF,
    label: 'ehow (SKS · ehowgjardagevnrluult)',
  },
];

async function checkMigrationIdentity() {
  // 1. Collect canonical migration filenames from the repo.
  let repoFiles;
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    repoFiles = entries
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (e) {
    return {
      error: `cannot read ${MIGRATIONS_DIR}: ${e.message}`,
      tenants: [],
    };
  }

  const repoSet = new Set(repoFiles);
  const tenantResults = [];

  for (const tenant of TENANT_DATA_PLANES) {
    if (!tenant.ref) {
      tenantResults.push({ ...tenant, skipped: true, gaps: [], outOfBand: [] });
      continue;
    }

    let appliedRows;
    try {
      appliedRows = await mgmtRows(tenant.ref, `
        SELECT name FROM _eq_migrations ORDER BY name;
      `);
    } catch (e) {
      tenantResults.push({ ...tenant, error: e.message, gaps: [], outOfBand: [] });
      continue;
    }

    // Normalise: old runner stored basename without .sql; new runner stores full filename.
    const appliedNormalised = appliedRows.map(r => {
      const n = r.name ?? '';
      return n.endsWith('.sql') ? n : `${n}.sql`;
    });
    const appliedSet = new Set(appliedNormalised);

    // Gaps: repo files not recorded in this tenant's _eq_migrations.
    const gaps = repoFiles.filter(f => !appliedSet.has(f));

    // Out-of-band: migrations recorded on tenant not matching any repo file.
    const outOfBand = appliedNormalised.filter(n => !repoSet.has(n));

    tenantResults.push({ ...tenant, gaps, outOfBand });
  }

  return { repoFiles, tenants: tenantResults };
}

let identityResult = null;

if (!args['anon-only']) {
  log('');
  log('running migration-identity check …');
  identityResult = await checkMigrationIdentity();
  if (identityResult.error) {
    log(`  error: ${identityResult.error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Output
// ═══════════════════════════════════════════════════════════════════════════

const identityFailed = identityResult != null
  && !identityResult.error
  && identityResult.tenants.some(t => !t.skipped && !t.error && (t.gaps.length > 0 || t.outOfBand.length > 0));

const anyFailure = driftResult.drift || anonFailed || identityFailed;

if (args.json) {
  console.log(JSON.stringify({
    drift: {
      skip: driftResult.skip,
      detected: driftResult.drift,
      reference: driftResult.refSlug,
      report: driftResult.report,
    },
    anon_grants: {
      skip: args['no-anon'],
      failed: anonFailed,
      projects: anonResults,
    },
    migration_identity: identityResult
      ? {
          skip: false,
          failed: identityFailed,
          repo_files: identityResult.repoFiles ?? [],
          tenants: identityResult.tenants,
        }
      : { skip: true },
  }, null, 2));
} else {
  // ── drift output ──
  if (!args['anon-only']) {
    if (driftResult.drift) {
      console.log(`\nReference tenant: ${driftResult.refSlug}`);
      for (const [slug, cats] of Object.entries(driftResult.report)) {
        console.log(`\n✗ ${slug} differs:`);
        for (const [cat, diff] of Object.entries(cats)) {
          for (const m of diff.missing) console.log(`    - [${cat}] MISSING here: ${m}`);
          for (const e of diff.extra)   console.log(`    + [${cat}] EXTRA here:   ${e}`);
        }
      }
    } else if (!driftResult.skip) {
      console.log(`\n✓ Cross-tenant drift: all tenants match '${driftResult.refSlug}'.`);
    }
  }

  // ── anon-grant output ──
  if (!args['no-anon']) {
    console.log('\n── Anon-grant invariant ────────────────────────────────────');
    for (const r of anonResults) {
      if (r.error) {
        console.log(`  ✗ ${r.label}: query error — ${r.error}`);
        continue;
      }
      if (!r.violations.length) {
        const note = r.intentional.length
          ? ` (${r.intentional.length} deliberate anon read${r.intentional.length > 1 ? 's' : ''} excluded)`
          : '';
        console.log(`  ✓ ${r.label}: clean${note}`);
      } else {
        console.log(`  ✗ ${r.label}: ${r.violations.length} table${r.violations.length > 1 ? 's' : ''} with unconstrained anon access`);
        for (const v of r.violations) {
          console.log(`      ${v.key}  grantee=${v.grantee}  privs=${v.privileges}  reason=${v.reason}`);
        }
      }
    }
    if (anonResults.length === 0) {
      console.log('  (skipped — no project refs configured)');
    }
  }

  // ── migration-identity output ──
  if (!args['anon-only'] && identityResult) {
    console.log('\n── Migration identity ──────────────────────────────────────');
    if (identityResult.error) {
      console.log(`  ✗ error: ${identityResult.error}`);
    } else {
      console.log(`  repo files: ${identityResult.repoFiles.length} (${identityResult.repoFiles[0]} … ${identityResult.repoFiles[identityResult.repoFiles.length - 1]})`);
      for (const t of identityResult.tenants) {
        if (t.skipped) {
          console.log(`  - ${t.label}: skipped (${t.envKey} not set)`);
          continue;
        }
        if (t.error) {
          console.log(`  ✗ ${t.label}: query error — ${t.error}`);
          continue;
        }
        if (!t.gaps.length && !t.outOfBand.length) {
          console.log(`  ✓ ${t.label}: all repo migrations applied, no out-of-band entries`);
        } else {
          console.log(`  ✗ ${t.label}:`);
          if (t.gaps.length) {
            console.log(`      ${t.gaps.length} repo file(s) NOT applied on this tenant:`);
            for (const g of t.gaps) console.log(`        - ${g}`);
          }
          if (t.outOfBand.length) {
            console.log(`      ${t.outOfBand.length} migration(s) applied on tenant NOT in repo:`);
            for (const o of t.outOfBand) console.log(`        + ${o}`);
          }
        }
      }
    }
  }
}

process.exit(anyFailure ? 2 : 0);

// ── helpers ──────────────────────────────────────────────────────────────
function log(m) { if (!args.json) console.log(`[drift] ${m}`); }
function fail(code, m) { console.error(`ERROR: ${m}`); process.exit(code); }
