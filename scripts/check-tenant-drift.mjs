#!/usr/bin/env node
// scripts/check-tenant-drift.mjs
//
// Three independent checks in one gate:
//
//   1. CROSS-TENANT DRIFT  — fingerprints app_data schema (tables, columns,
//      functions, policies, foreign keys + ON DELETE/ON UPDATE) across every
//      active tenant and reports where a tenant differs from the reference. The
//      FK signature is name-independent (source/target table + ordered columns +
//      referential action, NOT the constraint name) so the _fk/_fkey naming
//      inconsistency is not false drift, but an ON DELETE change (e.g. migration
//      048) is caught. INFORMATIONAL by default: the EQ and
//      SKS tenants diverge by design (different apps, independent migration
//      lineages), so tenant-vs-tenant equality is not a pass/fail gate. Pass
//      --strict-drift to make drift fail (e.g. comparing same-app tenants).
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
//   node scripts/check-tenant-drift.mjs --strict-drift   # make cross-tenant drift fail
//   node scripts/check-tenant-drift.mjs --json           # machine-readable output
//
// Required env:
//   SUPABASE_ACCESS_TOKEN            Management API token
//   CONTROL_PROJECT_REF              Control-plane ref (jvknxcmbtrfnxfrwfimn)
//   CANONICAL_INTERNAL_PROJECT_REF   EQ internal tenant ref (zaapmfdkgedqupfjtchl)
//   SKS_CANONICAL_PROJECT_REF        SKS tenant ref (ehowgjardagevnrluult)
//
// Exit codes: 0 = all clear, 1 = config error, 2 = failure detected.
// What fails the build (exit 2): a NEW anon-grant violation (not intentional/
// known-legacy), or a migration-identity query error. Cross-tenant drift and
// migration gaps/out-of-band are informational unless --strict-drift /
// --strict-identity are passed.

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
  // Cross-tenant structural drift is INFORMATIONAL by default: the EQ and SKS
  // tenants diverge by design (different apps, independent migration lineages),
  // so tenant-vs-tenant equality is not a meaningful pass/fail gate. Pass
  // --strict-drift to make drift fail the build (e.g. comparing same-app tenants).
  'strict-drift': { type: 'boolean', default: false },
  // Migration-identity gaps / out-of-band are likewise informational by default
  // (divergent lineages). --strict-identity makes them fail. Query errors always fail.
  'strict-identity': { type: 'boolean', default: false },
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
    ),
    'foreign_keys', (
      -- NAME-INDEPENDENT FK signature: source table + ordered source columns ->
      -- referenced table + ordered referenced columns + ON DELETE/ON UPDATE
      -- action. Deliberately excludes the constraint NAME so the known _fk vs
      -- _fkey naming inconsistency does not register as drift — only a real
      -- structural or referential-action difference does. This is the gap that
      -- let migration 048 (spine ON DELETE normalisation) slip past the guard.
      select coalesce(jsonb_agg(sig order by sig), '[]'::jsonb) from (
        select
          srcns.nspname || '.' || srcrel.relname || ' ('
          || (select string_agg(a.attname, ',' order by k.ord)
                from unnest(c.conkey) with ordinality as k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          || ') -> '
          || tgtns.nspname || '.' || tgtrel.relname || ' ('
          || (select string_agg(a.attname, ',' order by k.ord)
                from unnest(c.confkey) with ordinality as k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
          || ')'
          || ' ON DELETE ' || (case c.confdeltype
                when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' else c.confdeltype::text end)
          || ' ON UPDATE ' || (case c.confupdtype
                when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' else c.confupdtype::text end) as sig
        from pg_constraint c
        join pg_class     srcrel on srcrel.oid = c.conrelid
        join pg_namespace srcns  on srcns.oid  = srcrel.relnamespace
        join pg_class     tgtrel on tgtrel.oid = c.confrelid
        join pg_namespace tgtns  on tgtns.oid  = tgtrel.relnamespace
        where c.contype = 'f'
          and srcns.nspname = 'app_data'
      ) fk
    )
  ) as fp;
`;

async function fingerprint(ref) {
  const rows = await mgmtRows(ref, FINGERPRINT_SQL);
  return rows?.[0]?.fp ?? { tables: [], columns: [], functions: [], policies: [], foreign_keys: [] };
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

  const CATS = ['tables', 'columns', 'functions', 'policies', 'foreign_keys'];
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
// org lookup, schema registry). Low-sensitivity, deliberate, permanent. Do NOT
// add data tables here — bootstrap reads belong in service_role functions.
const INTENTIONAL_ANON_READS = {
  jvknxcmbtrfnxfrwfimn: new Set([          // control plane
    'public.organisations',
    'public.module_entitlements',
    'shell_control.eq_schema_registry',
  ]),
  ehowgjardagevnrluult: new Set([          // SKS tenant — same schema-version discovery read
    'shell_control.eq_schema_registry',
  ]),
};

// KNOWN-LEGACY anon exposure — accepted as TRACKED DEBT, not approval to keep.
// zaap (eq-canonical-internal) carries EQ Field's pre-canonical access model:
// Field runs purely as the anon role (PIN-gated client-side, no Supabase Auth /
// auth.uid()), so these public.* tables have USING(true) anon policies and most
// are anon-writable. Confirmed 2026-06-03 that revoking them breaks EQ Field
// (eq / demo-trades / melbourne tenants) until its read/write path moves behind
// an authenticated identity (server-side proxy or per-user JWT + rewritten RLS).
// See eq-solves-field SECURITY-REMEDIATION-HANDOFF.md (finding #4) / SKS-CUTOVER.
// This baseline keeps the debt VISIBLE while letting the gate FAIL on any anon-
// open table that is NOT already listed here (i.e. new regressions still block).
// Burn-down: started at 36 (2026-06-03). Removed 11 Field-UNUSED tables after revoking
// anon on zaap (verified anon has no privilege) — they must now HARD-FAIL if anon access
// ever returns. Remaining 25 are the tables EQ Field actively uses; they leave the baseline
// one at a time as each surface cuts over to canonical app_data (see remediation sprint).
const KNOWN_LEGACY_ANON = {
  zaapmfdkgedqupfjtchl: new Set([
    'public.app_config', 'public.apprentice_journal', 'public.apprentice_profiles',
    'public.audit_log', 'public.competencies', 'public.feedback_entries',
    'public.feedback_requests', 'public.job_numbers', 'public.leave_requests',
    'public.managers', 'public.organisations', 'public.people', 'public.prestarts',
    'public.project_targets', 'public.projects', 'public.regions',
    'public.roster_presence', 'public.rotations', 'public.schedule',
    'public.site_diaries', 'public.sites', 'public.skills_ratings',
    'public.timesheet_locks', 'public.timesheets', 'public.toolbox_talks',
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
    return { ref, label, error: e.message, violations: [], intentional: [], knownLegacy: [] };
  }

  const exclusions = INTENTIONAL_ANON_READS[ref] ?? new Set();
  const legacy     = KNOWN_LEGACY_ANON[ref] ?? new Set();
  const violations = [];
  const intentional = [];
  const knownLegacy = [];

  for (const row of rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    // Reachable by this grantee = RLS off (grants apply directly) OR an
    // unconditional permissive policy exists. Identity-gated policies are not
    // reachable by an anon request, so they are intentionally not flagged.
    const reachable = row.rls_enabled === false || row.open_policy_count > 0;
    if (!reachable) continue;
    row.reason = row.rls_enabled === false ? 'rls-disabled' : 'open-policy';
    if (legacy.has(key)) {
      // Tracked legacy debt — surfaced but does not fail the gate.
      knownLegacy.push({ ...row, key });
      continue;
    }
    if (exclusions.has(key)) {
      // Deliberate, documented bootstrap reads (login page org lookup, etc.).
      intentional.push({ ...row, key });
      continue;
    }
    violations.push({ ...row, key });
  }

  return { ref, label, violations, intentional, knownLegacy };
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
        SELECT name FROM app_data._eq_migrations ORDER BY name;
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

// A real error (couldn't query a tenant) always fails. Gaps / out-of-band are
// INFORMATIONAL by default — the EQ and SKS tenants run divergent migration
// lineages by design, so comparing both against the single EQ repo is noisy.
// Pass --strict-identity to enforce (e.g. for same-lineage tenants).
const identityError = identityResult != null && (
  !!identityResult.error ||
  identityResult.tenants.some(t => !t.skipped && t.error)
);
const identityDrift = identityResult != null && !identityResult.error
  && identityResult.tenants.some(t => !t.skipped && !t.error && (t.gaps.length > 0 || t.outOfBand.length > 0));
const identityFailed = identityError || (identityDrift && args['strict-identity']);

const driftFails = driftResult.drift && args['strict-drift'];
const anyFailure = driftFails || anonFailed || identityFailed;

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
      const tag = args['strict-drift'] ? 'FAIL' : 'informational — EQ/SKS tenants diverge by design; use --strict-drift to enforce';
      console.log(`\n── Cross-tenant drift (${tag}) ──────────────────────────────`);
      console.log(`Reference tenant: ${driftResult.refSlug}`);
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
      const notes = [];
      if (r.intentional.length) notes.push(`${r.intentional.length} deliberate read${r.intentional.length > 1 ? 's' : ''}`);
      if (r.knownLegacy.length) notes.push(`${r.knownLegacy.length} known-legacy (tracked)`);
      const note = notes.length ? ` (${notes.join(', ')} excluded)` : '';
      if (!r.violations.length) {
        console.log(`  ✓ ${r.label}: clean${note}`);
      } else {
        console.log(`  ✗ ${r.label}: ${r.violations.length} NEW table${r.violations.length > 1 ? 's' : ''} with unconstrained anon access${note}`);
        for (const v of r.violations) {
          console.log(`      ${v.key}  grantee=${v.grantee}  privs=${v.privileges}  reason=${v.reason}`);
        }
      }
      // Surface tracked legacy debt every run so it stays visible.
      if (r.knownLegacy.length) {
        const tbls = [...new Set(r.knownLegacy.map(v => v.key))];
        console.log(`    ↳ known-legacy anon access (EQ Field, tracked — see KNOWN_LEGACY_ANON): ${tbls.length} tables`);
      }
    }
    if (anonResults.length === 0) {
      console.log('  (skipped — no project refs configured)');
    }
  }

  // ── migration-identity output ──
  if (!args['anon-only'] && identityResult) {
    const itag = args['strict-identity'] ? 'strict' : 'informational — divergent lineages; use --strict-identity to enforce';
    console.log(`\n── Migration identity (${itag}) ─────────────────────────────`);
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
          console.log(`  ${args['strict-identity'] ? '✗' : '⚠'} ${t.label}:`);
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
