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
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mgmtRows, controlRef, requireAccessToken, mapWithConcurrency } from './_mgmt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  // SPINE-SCOPED enforcement: the canonical spine (tables CREATEd by
  // supabase/tenant-migrations/*.sql) MUST be identical on every tenant — that's
  // the governed surface the One Pipe rolls out. --strict-spine fails the build
  // on drift that touches a SPINE table (its columns, policies, or FKs), while
  // non-spine tables (module layers like field_*, and legacy app tables) stay
  // informational. This is the CI default for the blocking gate: enforce the core
  // without drowning in the by-design app-layer differences.
  'strict-spine': { type: 'boolean', default: false },
  // Migration-identity gaps / out-of-band are likewise informational by default
  // (divergent lineages). --strict-identity makes them fail. Query errors always fail.
  'strict-identity': { type: 'boolean', default: false },
  // CHECK 5 — tenant-isolation policy lint (Phase 5.2).
  // Every app_data table that has RLS ON and is NOT service-role-only MUST have
  // at least one permissive policy whose USING or WITH CHECK clause references
  // tenant_id. A table without such a policy blocks all browser reads (deny-all)
  // which is almost always a migration bug rather than intentional. ABSOLUTE by
  // default: --no-policy-lint skips it entirely.
  'no-policy-lint': { type: 'boolean', default: false },
  // Write the full JSON report to this file path regardless of --json.
  // Used by CI to feed the GitHub Issue automation step without a second run.
  'output-file':    { type: 'string' },
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
               -- B3: capture precision/scale/length so varchar(50) vs varchar(100) or
               -- numeric(10,2) vs numeric(12,4) registers as drift instead of silence.
               || case
                    when character_maximum_length is not null then '(' || character_maximum_length || ')'
                    when numeric_precision is not null then '(' || numeric_precision || ',' || coalesce(numeric_scale, 0) || ')'
                    else ''
                  end
               || case when is_nullable = 'NO' then ' NOT NULL' else '' end as sig
        from information_schema.columns
        where table_schema = 'app_data'
      ) c
    ),
    'enums', (
      -- B1: enum type label-sets across app_data + public. Without this dimension the
      -- gate is BLIND to enum drift (e.g. eq_role 5-vs-6 labels, worker_credential_type
      -- 26-vs-7) — the labels never appeared in any fingerprint, so the drift persisted.
      select coalesce(jsonb_agg(sig order by sig), '[]'::jsonb) from (
        select t.typname || ' = [' || string_agg(e.enumlabel, ',' order by e.enumsortorder) || ']' as sig
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where t.typtype = 'e' and n.nspname in ('app_data', 'public')
        group by t.typname
      ) en
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
    ),
    'effective_rls', (
      -- SEMANTIC RLS signature: per table, the EFFECTIVE access control, not the
      -- policy names/decomposition. Two tenants that express the same isolation
      -- differently (one ALL policy vs four per-command policies with the same
      -- gate) produce the SAME signature, so cosmetic decomposition is not drift —
      -- the same name-independence the FK signature already has. Captures:
      --   rls=<on/off>  · open=<true if any permissive USING(true) policy exists>
      --   gates=[distinct normalised tenant-scoped USING/WITH CHECK expressions]
      -- A genuinely open table (open=true / rls=off) or a different gate IS drift.
      select coalesce(jsonb_agg(sig order by sig), '[]'::jsonb) from (
        select t.tablename
          || ' rls=' || c.relrowsecurity
          || ' open=' || coalesce(bool_or(p.permissive = 'PERMISSIVE' and btrim(coalesce(p.qual, '')) = 'true'), false)
          || ' gates=[' || coalesce((
               -- Distinct SET of tenant-scoped gate expressions across all permissive
               -- policies on the table — each USING and each WITH CHECK collected
               -- SEPARATELY (not paired per policy), so one ALL policy and many
               -- per-command policies carrying the same expression collapse to the
               -- same set. Decomposition-independent; still expression-sensitive.
               select string_agg(distinct g, '; ' order by g) from (
                 select regexp_replace(p2.qual, '\\s+', ' ', 'g') as g
                 from pg_policies p2
                 where p2.schemaname = 'app_data' and p2.tablename = t.tablename
                   and p2.permissive = 'PERMISSIVE' and p2.qual is not null and p2.qual ~ 'tenant_id'
                 union
                 select regexp_replace(p2.with_check, '\\s+', ' ', 'g')
                 from pg_policies p2
                 where p2.schemaname = 'app_data' and p2.tablename = t.tablename
                   and p2.permissive = 'PERMISSIVE' and p2.with_check is not null and p2.with_check ~ 'tenant_id'
               ) gg
             ), '') || ']' as sig
        from pg_tables t
        join pg_class     c on c.relname = t.tablename
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'app_data'
        left join pg_policies p on p.schemaname = 'app_data' and p.tablename = t.tablename
        where t.schemaname = 'app_data'
        group by t.tablename, c.relrowsecurity
      ) er
    )
  ) as fp;
`;

async function fingerprint(ref) {
  const rows = await mgmtRows(ref, FINGERPRINT_SQL);
  return rows?.[0]?.fp ?? { tables: [], columns: [], functions: [], policies: [], foreign_keys: [], effective_rls: [], enums: [] };
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
  await mapWithConcurrency(tenants, 3, async (t) => {
    fps[t.slug] = await fingerprint(t.ref);
    log(`fingerprinted ${t.slug} (${t.ref})`);
  });

  const refSlug = args.reference ?? tenants[0].slug;
  if (!fps[refSlug]) fail(1, `reference '${refSlug}' not among ${tenants.map(t => t.slug).join(', ')}`);

  // The SPINE = every table CREATEd by the canonical migrations. Drift on these
  // is the blocking surface under --strict-spine; everything else (module layers,
  // legacy app tables) is informational.
  const spineTables = await loadSpineTables();
  log(`spine = ${spineTables.size} tables created by the canonical migrations`);

  // 'effective_rls' is the SEMANTIC isolation dimension used for spine enforcement;
  // 'policies' is kept for raw visibility but is informational only (its name/
  // decomposition differences are cosmetic — see tag() below).
  const CATS = ['tables', 'columns', 'functions', 'policies', 'foreign_keys', 'effective_rls', 'enums'];
  const report = {};
  let drift = false;       // any cross-tenant difference (informational umbrella)
  let spineDrift = false;  // a difference that touches a SPINE table (blocking surface)

  for (const t of tenants) {
    if (t.slug === refSlug) continue;
    const cats = {};
    for (const cat of CATS) {
      const refSet = new Set(fps[refSlug][cat]);
      const curSet = new Set(fps[t.slug][cat]);
      const missing = [...refSet].filter(x => !curSet.has(x));
      const extra   = [...curSet].filter(x => !refSet.has(x));
      if (!missing.length && !extra.length) continue;
      drift = true;
      // Classify each diff by the table it belongs to: spine vs non-spine.
      const tag = (items) => items.map(sig => {
        const tbl = diffTable(cat, sig);
        // Raw 'policies' never gates the spine — its name/decomposition differences
        // are cosmetic; 'effective_rls' is the semantic isolation signal instead.
        const isSpine = cat !== 'policies' && tbl != null && spineTables.has(tbl);
        if (isSpine) spineDrift = true;
        return { sig, spine: isSpine };
      });
      cats[cat] = { missing: tag(missing), extra: tag(extra) };
    }
    if (Object.keys(cats).length) report[t.slug] = cats;
  }

  driftResult = { skip: false, drift, spineDrift, report, refSlug, spineCount: spineTables.size };
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
//
// app_data.field_* views (0052/0054/0055): security_invoker=on views — the check
// flags rls_enabled=false on the view object but the underlying app_data tables
// (staff, sites, timesheet_locks) all have RLS enabled with tenant_id policies,
// so the view is NOT a real exposure. Authenticated access is intentional: Field
// reads managers/people/sites via these views using the caller's JWT tenant_id.
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
    // security_invoker views — RLS enforced on underlying tables (see comment above)
    'app_data.field_managers', 'app_data.field_people', 'app_data.field_sites',
    // EQ Service security_invoker=on views (0127 — SELECT FROM app_data.<table>): the
    // base app_data tables have RLS on with tenant_id policies; invoker-rights reads are
    // tenant-gated. Views can never have relrowsecurity=true — this is not a real exposure.
    'service.assets', 'service.customers', 'service.sites',
  ]),
  ehowgjardagevnrluult: new Set([
    // security_invoker views — RLS enforced on underlying tables (see comment above)
    'app_data.field_managers', 'app_data.field_people', 'app_data.field_sites',
    'app_data.field_timesheet_locks',
    // EQ Service security_invoker=on views (SELECT … FROM app_data.<table>): the
    // base app_data tables have RLS on with tenant_id policies, so invoker-rights
    // reads/writes are tenant-gated — the view object reporting rls=off is not a
    // real exposure (same pattern as the field_* views above).
    // service.contract_scopes (0123 canonical read-bridge): same pattern —
    // security_invoker view over app_data.contract_scopes (RLS-on, tenant SELECT
    // policy); anon has no privileges, and the base table grants authenticated
    // SELECT-only, so the view's residual INSERT/UPDATE/DELETE grants are inert
    // (the base table denies writes). Verified live on ehow 2026-06-16.
    'service.assets', 'service.contacts', 'service.customers', 'service.sites',
    'service.contract_scopes', 'service.staff',
    // EQ Service security_invoker=on views for test records, inspections, defects, etc.
    // All are thin SELECT * FROM app_data.<same_name> pass-throughs. RLS on the
    // underlying app_data tables enforces tenant isolation; views always report
    // rls_enabled=false (PostgreSQL invariant, not a gap). Verified SECURITY INVOKER 2026-06-25.
    // NOTE: underlying app_data tables are not yet created — views are currently inert.
    // When those tables land, their migration MUST include RLS + tenant policy.
    'service.acb_test_readings', 'service.acb_tests', 'service.asset_test_results',
    'service.attachments', 'service.check_assets', 'service.defects',
    'service.import_sessions', 'service.instruments', 'service.job_plan_items',
    'service.job_plans', 'service.maintenance_check_items', 'service.maintenance_checks',
    'service.notifications', 'service.nsx_test_readings', 'service.nsx_tests',
    'service.rcd_test_circuits', 'service.rcd_tests', 'service.test_record_readings',
    'service.test_records',
    // pass-through views on public.* (views cannot have RLS enabled — tracked debt)
    'app_data.field_audit_log', 'app_data.field_leave_requests', 'app_data.field_prestarts',
    'app_data.field_schedule', 'app_data.field_site_diaries', 'app_data.field_timesheets',
    'app_data.field_toolbox_talks',
    // Tender Pipeline + operational tables (open-policy: RLS on, USING(true) — Field JWT path)
    'public.app_config', 'public.nomination_clashes', 'public.nominations',
    'public.organisations', 'public.pending_schedule', 'public.pipeline_events',
    'public.team_members', 'public.teams', 'public.tender_enrichment',
    'public.tender_import_runs', 'public.tender_phases', 'public.tender_review_decisions',
    'public.tenders',
    // Legacy nspbmir Field tables — same set as zaap; authenticated access required
    // while the nspbmir→ehow Field unification arc is in-flight. Lock down via 0067
    // once SKS Field migration is complete.
    'public.job_numbers', 'public.leave_requests', 'public.managers',
    'public.people', 'public.prestarts', 'public.project_targets',
    'public.projects', 'public.regions', 'public.roster_presence',
    'public.schedule', 'public.site_diaries', 'public.sites',
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

// ── CHECK 6 helpers: anon-reachable SECURITY DEFINER function invariant ──────
// CHECK 2 inspects TABLE grants only; function EXECUTE grants are invisible to it
// — that is how the anon-executable definer readers eq_get_org_licences /
// eq_field_get_worker_summary (worker PII) shipped undetected. SECURITY DEFINER
// bypasses RLS, so an anon-callable definer fn with no auth.uid()/is_org_admin
// guard is a direct unauthenticated read/write. Allow-list = a baseline snapshot
// of the current intentionally-anon set (Cards pre-auth onboarding + auth.uid()-
// scoped self-service + trigger fns), keyed by plane label. TRACKED = known PII
// leaks pending the revoke migration (surfaced, non-failing). A plane with no
// allow-list is reported informationally (seed it to enforce) — never a false fail.
const FUNC_EXEC_ANON_ALLOW = {
  'eq-canonical (control plane)': new Set([
    'eq_cards_auto_provision()',
    'eq_cards_cancel_access_request(uuid)',
    'eq_cards_claim_invite(text)',
    'eq_cards_find_pending_invite()',
    'eq_cards_list_incoming_requests()',
    'eq_cards_list_my_licence_backing()',
    'eq_cards_list_my_tenants()',
    'eq_cards_list_outgoing_requests(uuid)',
    'eq_cards_lookup_invite_by_phone(text,text)',
    'eq_cards_preview_invite(uuid)',
    'eq_cards_request_worker_access(uuid,text,text)',
    'eq_cards_respond_to_access_request(uuid,boolean)',
    'eq_cards_revoke_org_access(uuid)',
    'eq_cards_set_active_tenant(uuid)',
    'handle_phone_dedup()',
    'notify_connection_request()',
    'tg_fulfil_access_requests_on_claim()',
  ]),
};

const FUNC_EXEC_ANON_TRACKED = {
  // eq_get_org_licences + eq_field_get_worker_summary revoked 2026-06-27 via
  // Field canon-read proxy (PR #348) + migration revoke_anon_authenticated_pii_functions.
};

const FUNC_EXEC_SQL = `
  SELECT
    p.oid::regprocedure::text AS signature
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'shell_control')
    AND p.prokind = 'f'
    AND p.prosecdef = true
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ORDER BY signature;
`;

async function checkFunctionExec(ref, label) {
  const allow = FUNC_EXEC_ANON_ALLOW[label];
  if (!allow) return { ref, label, skipped: true, violations: [], tracked: [] };
  const tracked = FUNC_EXEC_ANON_TRACKED[label] ?? new Set();
  let rows;
  try {
    rows = await mgmtRows(ref, FUNC_EXEC_SQL);
  } catch (e) {
    return { ref, label, error: e.message, violations: [], tracked: [] };
  }
  const violations = [];
  const trackedHits = [];
  for (const row of rows) {
    const sig = row.signature;
    if (allow.has(sig)) continue;
    if (tracked.has(sig)) { trackedHits.push({ signature: sig }); continue; }
    violations.push({ signature: sig });
  }
  return { ref, label, violations, tracked: trackedHits };
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
// CHECK 6 — Function-EXECUTE invariant (anon-reachable SECURITY DEFINER fns)
// ═══════════════════════════════════════════════════════════════════════════
let funcExecResults = [];
let funcExecFailed = false;
if (!args['no-anon']) {
  log('');
  log('running function-EXECUTE invariant check …');
  for (const proj of CANONICAL_PROJECTS) {
    if (!proj.ref) continue;
    const result = await checkFunctionExec(proj.ref, proj.label);
    funcExecResults.push(result);
    if (result.error || result.violations.length) funcExecFailed = true;
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
// CHECK 4 — Spine RLS invariant (ABSOLUTE, per plane)
// ═══════════════════════════════════════════════════════════════════════════
//
// CHECK 1's effective_rls dimension is RELATIVE — it only flags when two tenants
// DISAGREE. That misses a wrong-but-CONSISTENT state: if a spine table has RLS
// disabled on EVERY plane (the original 0037 bug — migration_baseline shipped
// grants-only, no ENABLE RLS), the planes match and the spine looks clean while
// the table is actually unprotected. This check is ABSOLUTE and covers the WHOLE
// spine:
//   • EVERY spine table (created by a canonical migration) MUST be RLS=on on
//     every data plane — the app_data norm is RLS-on for all tables, no exceptions.
//   • SERVICE_ROLE_ONLY tables additionally MUST have no anon/authenticated grant
//     and no unconditional (USING true) policy — they have no browser path.
// A violation always fails the build — there is no flag to downgrade it, because
// there is no correct state where a governed table is unprotected. Absent spine
// tables are informational (lineages diverge by design), not a failure.
//
// Keep SERVICE_ROLE_ONLY in sync with scripts/regen-tenant-baseline.mjs.
const SERVICE_ROLE_ONLY = new Set([
  'migration_baseline',
  '_eq_migrations',
  // SKS-only comms tables (0066) — service_role path via Netlify fns; no browser access.
  'sks_comms_jobs',
  'sks_comms_po_lines',
  'sks_comms_materials',
  'sks_comms_labour_rates',
  'sks_comms_events',
]);

function spineRlsSql(spineTables) {
  const values = spineTables.map(t => `('${t}')`).join(',');
  return `
    select t.tablename,
      c.relrowsecurity as rls_enabled,
      exists(select 1 from information_schema.role_table_grants g
             where g.table_schema='app_data' and g.table_name=t.tablename
               and g.grantee in ('anon','authenticated')) as caller_grant,
      exists(select 1 from pg_policies p
             where p.schemaname='app_data' and p.tablename=t.tablename
               and p.permissive='PERMISSIVE'
               and (trim(coalesce(p.qual,''))='true' or trim(coalesce(p.with_check,''))='true')) as open_policy
    from (values ${values}) as t(tablename)
    join pg_class c on c.relname = t.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'app_data' and c.relkind = 'r';
  `;
}

async function checkSpineRls() {
  const spine = [...await loadSpineTables()].sort();
  const sql = spineRlsSql(spine);
  const planes = [];
  for (const plane of TENANT_DATA_PLANES) {
    if (!plane.ref) { planes.push({ ...plane, skipped: true, violations: [], missing: [], present: 0 }); continue; }
    let rows;
    try {
      rows = await mgmtRows(plane.ref, sql);
    } catch (e) {
      planes.push({ ...plane, error: e.message, violations: [], missing: [], present: 0 });
      continue;
    }
    const presentSet = new Set(rows.map(r => r.tablename));
    const violations = [];
    for (const r of rows) {
      const reasons = [];
      if (r.rls_enabled === false) reasons.push('RLS disabled');                 // every spine table
      if (SERVICE_ROLE_ONLY.has(r.tablename)) {                                   // ledger/service-role tables only
        if (r.caller_grant === true) reasons.push('anon/authenticated grant');
        if (r.open_policy === true)  reasons.push('USING(true) policy');
      }
      if (reasons.length) violations.push({ table: r.tablename, reasons });
    }
    const missing = spine.filter(t => !presentSet.has(t));   // absent = lineage divergence, informational
    planes.push({ ...plane, present: presentSet.size, missing, violations });
  }
  return { spineCount: spine.length, planes };
}

let spineRlsResult = { spineCount: 0, planes: [] };
let spineRlsFailed = false;
if (!args['anon-only']) {
  log('');
  log('running spine RLS invariant …');
  spineRlsResult = await checkSpineRls();
  for (const p of spineRlsResult.planes) {
    if (p.error || p.violations.length) spineRlsFailed = true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 5 — Tenant-isolation policy lint (Phase 5.2, ABSOLUTE)
// ═══════════════════════════════════════════════════════════════════════════
//
// Every app_data table with RLS=on that is NOT service-role-only MUST have at
// least one permissive policy whose USING or WITH CHECK clause references
// tenant_id. A table without such a policy quietly denies ALL browser reads
// (deny-all = RLS-on + no permissive policy), which is almost always a
// forgotten policy rather than intentional. This check is ABSOLUTE — no flag
// downgrades it — because there is no valid state where a user-readable
// app_data table has RLS=on and zero tenant-scoped policies.
//
// Tables in SERVICE_ROLE_ONLY are exempt: deny-all is the correct posture for
// service-role-only ledger tables (_eq_migrations, migration_baseline).
//
// Tables with RLS=off are already caught by CHECK 4 (spine-RLS). This check
// is complementary: it finds tables that passed CHECK 4 (RLS=on) but are
// missing the positive tenant-isolation policy that actually routes reads.
//
// Absent tables (lineage divergence) are informational (same as CHECK 4).

const POLICY_LINT_SQL = `
  SELECT
    t.tablename,
    c.relrowsecurity AS rls_on,
    -- B4: is the table reachable by a browser role at all? RLS=on with NO
    -- anon/authenticated grant and no policy is an INTENTIONAL lockdown (deny-all
    -- is correct) and must PASS — not be pressured open. Only browser-reachable
    -- tables that lack an isolation policy are real bugs.
    exists(
      SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'app_data' AND g.table_name = t.tablename
        AND g.grantee IN ('anon', 'authenticated')
    ) AS caller_grant,
    (
      -- B5: org_id is a valid isolation column too (tender_* scope on org_id, not
      -- tenant_id). Count a policy scoping by EITHER so org_id-scoped tables are
      -- not false-flagged as missing isolation.
      SELECT count(*)::int
      FROM pg_policies p
      WHERE p.schemaname = 'app_data' AND p.tablename = t.tablename
        AND p.permissive = 'PERMISSIVE'
        AND (
          (p.qual       IS NOT NULL AND (p.qual       LIKE '%tenant_id%' OR p.qual       LIKE '%org_id%')) OR
          (p.with_check IS NOT NULL AND (p.with_check LIKE '%tenant_id%' OR p.with_check LIKE '%org_id%'))
        )
    ) AS iso_policy_count
  FROM pg_tables t
  JOIN pg_class     c ON c.relname = t.tablename
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'app_data'
  WHERE t.schemaname = 'app_data'
  ORDER BY t.tablename;
`;

async function checkPolicyLint() {
  const spine = await loadSpineTables();
  const planes = [];

  for (const plane of TENANT_DATA_PLANES) {
    if (!plane.ref) {
      planes.push({ ...plane, skipped: true, violations: [], missing: [] });
      continue;
    }

    let rows;
    try {
      rows = await mgmtRows(plane.ref, POLICY_LINT_SQL);
    } catch (e) {
      planes.push({ ...plane, error: e.message, violations: [], missing: [] });
      continue;
    }

    const violations = [];
    const missing    = [];

    for (const r of rows) {
      const tbl = r.tablename;
      // Service-role-only tables: deny-all is the correct posture — skip.
      if (SERVICE_ROLE_ONLY.has(tbl)) continue;
      // RLS-off tables are caught by CHECK 4 — skip here (avoid double-reporting).
      if (r.rls_on === false) continue;
      // B4: RLS=on with NO browser grant is an intentional lockdown (deny-all is
      // correct) — PASS, don't pressure it open. Only browser-reachable tables
      // need an isolation policy.
      if (r.caller_grant === false) continue;
      // B5: RLS=on + browser-reachable + no tenant_id/org_id policy = real gap.
      if (r.iso_policy_count === 0) {
        const isSpine = spine.has(tbl);
        violations.push({ table: tbl, isSpine });
      }
    }

    // Spine tables absent on this plane (lineage divergence) — informational.
    const presentSet = new Set(rows.map(r => r.tablename));
    const missingSpine = [...spine].filter(t => !presentSet.has(t));
    missing.push(...missingSpine);

    planes.push({ ...plane, violations, missing });
  }

  return { planes };
}

let policyLintResult = { planes: [] };
let policyLintFailed = false;
if (!args['anon-only'] && !args['no-policy-lint']) {
  log('');
  log('running tenant-isolation policy lint …');
  policyLintResult = await checkPolicyLint();
  for (const p of policyLintResult.planes) {
    if (p.error || p.violations.length) policyLintFailed = true;
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
const spineFails = driftResult.spineDrift && args['strict-spine'];
const anyFailure = driftFails || spineFails || anonFailed || identityFailed || spineRlsFailed || policyLintFailed || funcExecFailed;

const _report = {
  drift: {
    skip: driftResult.skip,
    detected: driftResult.drift,
    spine_drift: driftResult.spineDrift,
    spine_table_count: driftResult.spineCount,
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
  spine_rls: {
    skip: args['anon-only'],
    failed: spineRlsFailed,
    spine_table_count: spineRlsResult.spineCount,
    planes: spineRlsResult.planes,
  },
  policy_lint: {
    skip: args['anon-only'] || args['no-policy-lint'],
    failed: policyLintFailed,
    planes: policyLintResult.planes,
  },
  function_exec: {
    skip: args['no-anon'],
    failed: funcExecFailed,
    projects: funcExecResults,
  },
};

if (args['output-file']) {
  await writeFile(args['output-file'], JSON.stringify(_report, null, 2));
}

if (args.json) {
  console.log(JSON.stringify(_report, null, 2));
} else {
  // ── drift output ──
  if (!args['anon-only']) {
    if (driftResult.drift) {
      const spineTag = args['strict-spine'] ? 'BLOCKING' : 'informational — use --strict-spine to enforce';
      console.log(`\n── Cross-tenant drift ───────────────────────────────────────`);
      console.log(`Reference: ${driftResult.refSlug}   ·   spine = ${driftResult.spineCount} governed tables`);
      for (const [slug, cats] of Object.entries(driftResult.report)) {
        const spineLines = [];
        let nonSpine = 0;
        for (const [cat, diff] of Object.entries(cats)) {
          for (const m of diff.missing) m.spine ? spineLines.push(`      - [${cat}] MISSING here: ${m.sig}`) : nonSpine++;
          for (const e of diff.extra)   e.spine ? spineLines.push(`      + [${cat}] EXTRA here:   ${e.sig}`) : nonSpine++;
        }
        console.log(`\n  ${slug}:`);
        if (spineLines.length) {
          console.log(`    ✗ SPINE drift (${spineTag}) — ${spineLines.length} item(s):`);
          for (const l of spineLines) console.log(l);
        } else {
          console.log(`    ✓ spine clean`);
        }
        if (nonSpine) console.log(`    ℹ ${nonSpine} non-spine difference(s) — module/legacy layer, informational`);
      }
      console.log(driftResult.spineDrift
        ? `\n✗ Spine drift detected${args['strict-spine'] ? ' — FAILING build (--strict-spine)' : ' (informational)'}.`
        : `\n✓ SPINE identical across all tenants — the governed surface is aligned.`);
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

  // ── spine RLS invariant output ──
  if (!args['anon-only']) {
    console.log(`\n── Spine RLS invariant (${spineRlsResult.spineCount} governed tables) ──────────`);
    for (const p of spineRlsResult.planes) {
      if (p.skipped) { console.log(`  - ${p.label}: skipped (${p.envKey} not set)`); continue; }
      if (p.error)   { console.log(`  ✗ ${p.label}: query error — ${p.error}`); continue; }
      if (!p.violations.length) {
        const miss = p.missing.length ? ` (${p.missing.length} absent — lineage divergence: ${p.missing.join(', ')})` : '';
        console.log(`  ✓ ${p.label}: ${p.present}/${spineRlsResult.spineCount} present, all RLS-on${miss}`);
      } else {
        console.log(`  ✗ ${p.label}: ${p.violations.length} spine table(s) violate the RLS invariant`);
        for (const v of p.violations) console.log(`      ${v.table} — ${v.reasons.join(', ')}`);
      }
    }
  }

  // ── tenant-isolation policy lint output ──
  if (!args['anon-only'] && !args['no-policy-lint']) {
    console.log(`\n── Tenant-isolation policy lint (ABSOLUTE) ─────────────────`);
    for (const p of policyLintResult.planes) {
      if (p.skipped) { console.log(`  - ${p.label}: skipped (${p.envKey} not set)`); continue; }
      if (p.error)   { console.log(`  ✗ ${p.label}: query error — ${p.error}`); continue; }
      if (!p.violations.length) {
        const miss = p.missing?.length ? ` (${p.missing.length} spine tables absent — lineage divergence)` : '';
        console.log(`  ✓ ${p.label}: all browser-reachable RLS-on app_data tables have a tenant_id/org_id policy${miss}`);
      } else {
        const spineCount = p.violations.filter(v => v.isSpine).length;
        console.log(`  ✗ ${p.label}: ${p.violations.length} browser-reachable table(s) with RLS=on but NO tenant_id/org_id policy (${spineCount} spine):`);
        for (const v of p.violations) {
          const tag = v.isSpine ? ' [SPINE]' : '';
          console.log(`      app_data.${v.table}${tag} — RLS-on + anon/authenticated grant, zero tenant-scoped policies → deny-all for browser`);
        }
        console.log(`    Fix: add a permissive policy USING (tenant_id = ...) or USING (org_id = ...), or revoke the anon/authenticated grant if it is service-role-only.`);
      }
    }
  }

  // ── function-EXECUTE invariant output ──
  if (!args['no-anon']) {
    console.log(`\n── Function-EXECUTE invariant (anon-reachable SECDEF) ──────`);
    for (const r of funcExecResults) {
      if (r.error)   { console.log(`  ✗ ${r.label}: query error — ${r.error}`); continue; }
      if (r.skipped) { console.log(`  - ${r.label}: no allow-list baseline — seed FUNC_EXEC_ANON_ALLOW to enforce`); continue; }
      const note = r.tracked.length ? ` (${r.tracked.length} tracked pending-revoke)` : '';
      if (!r.violations.length) {
        console.log(`  ✓ ${r.label}: clean${note}`);
      } else {
        console.log(`  ✗ ${r.label}: ${r.violations.length} NEW anon-executable SECURITY DEFINER function(s) not allow-listed${note}`);
        for (const v of r.violations) console.log(`      ${v.signature}`);
        console.log(`    Fix: REVOKE EXECUTE … FROM anon (service-role-only), or add an auth.uid()/is_org_admin guard, then add to FUNC_EXEC_ANON_ALLOW if deliberately anon.`);
      }
      if (r.tracked.length) {
        console.log(`    ↳ tracked pending-revoke (worker-PII; see hardening sprint): ${r.tracked.map(t => t.signature).join(', ')}`);
      }
    }
    if (funcExecResults.length === 0) console.log('  (skipped — no project refs configured)');
  }
}

process.exit(anyFailure ? 2 : 0);

// ── helpers ──────────────────────────────────────────────────────────────
function log(m) { if (!args.json) console.log(`[drift] ${m}`); }
function fail(code, m) { console.error(`ERROR: ${m}`); process.exit(code); }

// The spine table set = every app_data table CREATEd by a canonical migration.
// Derived from the files so it stays correct as migrations are added — no
// hand-maintained allowlist to fall out of date.
async function loadSpineTables() {
  const dir = join(__dirname, '..', 'supabase', 'tenant-migrations');
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const spine = new Set();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?app_data\.([a-z0-9_]+)/gi;
  // Migrations annotated with `-- @tenant-scope: <slug>` apply to one plane only.
  // Their tables are excluded from the universal spine so the drift check doesn't
  // flag them as EXTRA/MISSING on the planes they don't target.
  const tenantScopeRe = /--\s*@tenant-scope\s*:/i;
  for (const f of files) {
    const sql = await readFile(join(dir, f), 'utf8');
    // Skip this file's CREATE TABLE statements if it's scoped to a single tenant.
    if (tenantScopeRe.test(sql.slice(0, 500))) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sql))) spine.add(m[1].toLowerCase());
  }
  return spine;
}

// Which table a drift signature belongs to (null = not table-scoped, e.g. a
// free function — treated as non-spine / informational in this version).
function diffTable(cat, sig) {
  switch (cat) {
    case 'tables':       return sig.trim().toLowerCase();
    case 'columns':      return sig.split('.')[0].trim().toLowerCase();          // "table.col type …"
    case 'policies':     return sig.split('.')[0].trim().toLowerCase();          // "table.policy cmd …"
    case 'foreign_keys': { const m = sig.match(/^app_data\.([a-z0-9_]+)\s*\(/i); return m ? m[1].toLowerCase() : null; }
    case 'effective_rls': return sig.split(' ')[0].trim().toLowerCase();         // "<table> rls=… open=… gates=[…]"
    default:             return null;                                            // functions: not table-scoped
  }
}
