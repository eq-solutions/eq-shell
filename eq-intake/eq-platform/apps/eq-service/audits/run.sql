-- ============================================================
-- audits/run.sql
--
-- EQ Solves Service — data quality audit.
--
-- One read-only query. No schema changes. Safe to run any time,
-- in prod or a branch. Returns one row per check with level,
-- pass/fail, failure count, and a short detail string.
--
-- Framework: DAMA-DMBOK data-quality dimensions (completeness,
-- uniqueness, validity, consistency) plus Postgres/Supabase
-- structural checks (RLS, primary keys, FK covering indexes)
-- and soft-delete hygiene.
--
-- Levels:
--   ERROR — must be zero before a release. Fails CI.
--   WARN  — allowed to be non-zero with a documented reason.
--
-- Adding a new check:
--   1. Add a row to the `checks` CTE below.
--   2. Document it in audits/CHECKS.md with the reason it exists.
--   3. Re-run and confirm it behaves.
--
-- Last reviewed: 2026-04-16 (baseline).
-- ============================================================

with checks as (

  -- ==================================================
  -- COMPLETENESS — required fields not null
  -- ==================================================
  select 'completeness.assets.site_id'::text             as check_id, 'ERROR'::text as level, 'active asset with null site_id'::text as detail,
         (select count(*) from public.assets where is_active and site_id is null) as fail_count
  union all
  select 'completeness.assets.tenant_id', 'ERROR', 'active asset with null tenant_id',
         (select count(*) from public.assets where is_active and tenant_id is null)
  union all
  select 'completeness.assets.job_plan_id', 'WARN', 'active asset with null job_plan_id (manual assignment pending)',
         (select count(*) from public.assets where is_active and job_plan_id is null)
  union all
  select 'completeness.sites.customer_id', 'ERROR', 'active site with null customer_id',
         (select count(*) from public.sites where is_active and customer_id is null)
  union all
  select 'completeness.sites.code', 'ERROR', 'active site with null code',
         (select count(*) from public.sites where is_active and code is null)
  union all
  select 'completeness.sites.city', 'ERROR', 'active site with null city',
         (select count(*) from public.sites where is_active and city is null)
  union all
  select 'completeness.sites.postcode', 'ERROR', 'active site with null postcode',
         (select count(*) from public.sites where is_active and postcode is null)
  union all
  select 'completeness.sites.state', 'ERROR', 'active site with null state',
         (select count(*) from public.sites where is_active and state is null)
  union all
  select 'completeness.customers.name', 'ERROR', 'active customer with null name',
         (select count(*) from public.customers where is_active and (name is null or trim(name) = ''))
  union all
  select 'completeness.defects.asset_id', 'ERROR', 'defect with null asset_id',
         (select count(*) from public.defects where asset_id is null)
  union all
  select 'completeness.maintenance_checks.site_id', 'ERROR', 'active maintenance_check with null site_id',
         (select count(*) from public.maintenance_checks where is_active and site_id is null)
  union all
  select 'completeness.pm_calendar.site_id', 'ERROR', 'active pm_calendar row with null site_id',
         (select count(*) from public.pm_calendar where is_active and site_id is null)

  -- ==================================================
  -- UNIQUENESS — no duplicates on natural keys
  -- ==================================================
  union all
  select 'uniqueness.customers.tenant_name', 'ERROR', 'duplicate active customer within a tenant by name',
         (select count(*) from (
            select tenant_id, lower(trim(name)) as n
            from public.customers where is_active
            group by 1,2 having count(*) > 1
          ) x)
  union all
  select 'uniqueness.sites.tenant_code', 'ERROR', 'duplicate active site within a tenant by code',
         (select count(*) from (
            select tenant_id, lower(trim(code)) as c
            from public.sites where is_active and code is not null
            group by 1,2 having count(*) > 1
          ) x)
  union all
  select 'uniqueness.sites.tenant_name', 'ERROR', 'duplicate active site within a tenant by name',
         (select count(*) from (
            select tenant_id, lower(trim(name)) as n
            from public.sites where is_active
            group by 1,2 having count(*) > 1
          ) x)
  union all
  select 'uniqueness.assets.site_serial', 'WARN', 'duplicate active asset within a site by serial_number',
         (select count(*) from (
            select site_id, serial_number
            from public.assets
            where is_active and serial_number is not null and trim(serial_number) <> ''
            group by 1,2 having count(*) > 1
          ) x)

  -- ==================================================
  -- VALIDITY — values inside allowed domain
  -- ==================================================
  union all
  select 'validity.sites.postcode_format', 'ERROR', 'site postcode not 4-digit AU format',
         (select count(*) from public.sites where is_active and postcode is not null and postcode !~ '^[0-9]{4}$')
  union all
  select 'validity.sites.state_au', 'ERROR', 'site state not a valid AU state/territory code',
         (select count(*) from public.sites where is_active and state is not null
            and state not in ('NSW','VIC','QLD','WA','SA','TAS','NT','ACT'))
  union all
  select 'validity.timestamps.assets', 'ERROR', 'asset updated_at < created_at',
         (select count(*) from public.assets where updated_at < created_at)
  union all
  select 'validity.timestamps.sites', 'ERROR', 'site updated_at < created_at',
         (select count(*) from public.sites where updated_at < created_at)
  union all
  select 'validity.timestamps.customers', 'ERROR', 'customer updated_at < created_at',
         (select count(*) from public.customers where updated_at < created_at)

  -- ==================================================
  -- CONSISTENCY — cross-table agreement
  -- ==================================================
  union all
  select 'consistency.assets.site_active', 'ERROR', 'active asset attached to archived site',
         (select count(*) from public.assets a join public.sites s on s.id = a.site_id
          where a.is_active and not s.is_active)
  union all
  select 'consistency.sites.customer_active', 'ERROR', 'active site attached to archived customer',
         (select count(*) from public.sites s join public.customers c on c.id = s.customer_id
          where s.is_active and not c.is_active)
  union all
  select 'consistency.assets.site_tenant_match', 'ERROR', 'asset.tenant_id does not equal site.tenant_id',
         (select count(*) from public.assets a join public.sites s on s.id = a.site_id
          where a.tenant_id is distinct from s.tenant_id)
  union all
  select 'consistency.sites.customer_tenant_match', 'ERROR', 'site.tenant_id does not equal customer.tenant_id',
         (select count(*) from public.sites s join public.customers c on c.id = s.customer_id
          where s.tenant_id is distinct from c.tenant_id)
  union all
  select 'consistency.acb_tests.site_matches_asset', 'ERROR', 'acb_test.site_id drifts from asset.site_id',
         (select count(*) from public.acb_tests x join public.assets a on a.id = x.asset_id
          where x.site_id is distinct from a.site_id)
  union all
  select 'consistency.nsx_tests.site_matches_asset', 'ERROR', 'nsx_test.site_id drifts from asset.site_id',
         (select count(*) from public.nsx_tests x join public.assets a on a.id = x.asset_id
          where x.site_id is distinct from a.site_id)
  union all
  select 'consistency.test_records.site_matches_asset', 'ERROR', 'test_record.site_id drifts from asset.site_id',
         (select count(*) from public.test_records x join public.assets a on a.id = x.asset_id
          where x.site_id is distinct from a.site_id)
  union all
  select 'consistency.defects.site_matches_asset', 'ERROR', 'defect.site_id drifts from asset.site_id',
         (select count(*) from public.defects x join public.assets a on a.id = x.asset_id
          where x.site_id is distinct from a.site_id)
  union all
  select 'consistency.acb_tests.tenant_matches_asset', 'ERROR', 'acb_test.tenant_id drifts from asset.tenant_id',
         (select count(*) from public.acb_tests x join public.assets a on a.id = x.asset_id
          where x.tenant_id is distinct from a.tenant_id)

  -- ==================================================
  -- FRESHNESS / TIMELINESS — DAMA timeliness dimension
  --
  -- These checks surface records that are "technically valid" but
  -- have grown stale. Thresholds are deliberately generous to avoid
  -- nagging on edge cases; tighten once the defect/test volume
  -- grows. All WARN-level — a stale record is a smell, not a block.
  -- ==================================================
  union all
  select 'freshness.defects.open_over_90_days', 'WARN', 'defect with status=open for more than 90 days',
         (select count(*) from public.defects
            where status = 'open'
              and created_at < now() - interval '90 days')
  union all
  select 'freshness.acb_tests.in_progress_over_30_days', 'WARN', 'active ACB test created >30 days ago with incomplete workflow',
         (select count(*) from public.acb_tests
            where is_active
              and created_at < now() - interval '30 days'
              and not (step1_status = 'complete' and step2_status = 'complete' and step3_status = 'complete'))
  union all
  select 'freshness.nsx_tests.in_progress_over_30_days', 'WARN', 'active NSX test created >30 days ago with incomplete workflow',
         (select count(*) from public.nsx_tests
            where is_active
              and created_at < now() - interval '30 days'
              and not (step1_status = 'complete' and step2_status = 'complete' and step3_status = 'complete'))

  -- ==================================================
  -- STRUCTURAL — Postgres / Supabase invariants
  -- ==================================================
  union all
  select 'structural.rls_enabled', 'ERROR', 'public table without row-level security',
         (select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relkind = 'r'
              and not c.relrowsecurity)
  union all
  select 'structural.primary_key', 'ERROR', 'public table without a primary key',
         (select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relkind = 'r'
              and not exists (
                select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary
              ))
  union all
  select 'structural.fk_covering_index', 'WARN', 'foreign key in public without a covering index',
         (select count(*) from (
            select con.oid
            from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
            where con.contype = 'f' and n.nspname = 'public'
              and not exists (
                select 1 from pg_index i
                where i.indrelid = con.conrelid
                  and (i.indkey::int[])[0:array_length(con.conkey,1)-1] = con.conkey::int[]
              )
          ) x)

  -- ==================================================
  -- SCALING — table sizes that should trigger action
  -- ==================================================
  union all
  select 'scaling.audit_logs.size', 'WARN', 'audit_logs > 500k rows — design partitioning + retention now',
         (case when (select count(*) from public.audit_logs) > 500000 then 1 else 0 end)

  -- .limit(10000) appears 23 times across 6 files (analytics, reports,
  -- compliance-report, maintenance list/detail, maintenance-checklist).
  -- At current scale (largest table 5193 rows) none are biting, so the
  -- refactor was deferred per the same monitor-don't-speculatively-refactor
  -- principle as audit_logs above. The threshold fires when ANY table
  -- pulled via .limit(10000) exceeds 50k rows — well before the 10k
  -- per-query cap matters, with ~6 months runway to swap in server-side
  -- aggregation.
  union all
  select 'scaling.maintenance_check_items.size', 'WARN', 'maintenance_check_items > 50k rows — refactor /maintenance/[id] + /maintenance + /api/maintenance-checklist away from .limit(10000)',
         (case when (select count(*) from public.maintenance_check_items) > 50000 then 1 else 0 end)
  union all
  select 'scaling.check_assets.size', 'WARN', 'check_assets > 50k rows — review queries using .limit(10000)',
         (case when (select count(*) from public.check_assets) > 50000 then 1 else 0 end)
  union all
  select 'scaling.maintenance_checks.size', 'WARN', 'maintenance_checks > 50k rows — refactor /analytics + /reports away from .limit(10000)',
         (case when (select count(*) from public.maintenance_checks where is_active) > 50000 then 1 else 0 end)
  union all
  select 'scaling.acb_tests.size', 'WARN', 'acb_tests > 50k rows — refactor /analytics + /reports away from .limit(10000)',
         (case when (select count(*) from public.acb_tests where is_active) > 50000 then 1 else 0 end)
  union all
  select 'scaling.nsx_tests.size', 'WARN', 'nsx_tests > 50k rows — refactor /analytics + /reports away from .limit(10000)',
         (case when (select count(*) from public.nsx_tests where is_active) > 50000 then 1 else 0 end)
  union all
  select 'scaling.test_records.size', 'WARN', 'test_records > 50k rows — refactor /analytics + /reports away from .limit(10000)',
         (case when (select count(*) from public.test_records where is_active) > 50000 then 1 else 0 end)
)
select
  check_id,
  level,
  case when fail_count = 0 then 'PASS' else 'FAIL' end as result,
  fail_count,
  detail
from checks
order by
  case when fail_count = 0 then 1 else 0 end,  -- failures first
  case level when 'ERROR' then 0 when 'WARN' then 1 else 2 end,
  check_id;
