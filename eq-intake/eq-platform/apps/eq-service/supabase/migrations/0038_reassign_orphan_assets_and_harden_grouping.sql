-- ============================================================
-- 0038_reassign_orphan_assets_and_harden_grouping.sql
--
-- Two linked fixes:
--
-- 1) DATA FIX — orphan assets attached to archived site rows
--    Background: on 2026-04-08 sites SY1 and SY4 were renumbered.
--    New empty site rows were created (is_active = true) while the
--    original rows were soft-archived, leaving 488 live assets
--    attached to archived parents. The Sites page correctly
--    reports 0 assets for the active SY1/SY4 rows, but the Assets
--    grouped view (get_assets_for_grouping) joins sites without
--    filtering on is_active and so still surfaces them under the
--    old names — inflating the visible counts by 377 + 111.
--
--    Confirmed mapping (Royce, 2026-04-15):
--      - archived SY1 (47 Bourke Rd, Alexandria) → active SY3 (47 Bourke Rd)
--      - archived SY4 (17 Bourke Rd — data entry error) → active SY4 (200 Bourke Rd)
--      - archived MEL1 (826 Lorimer St, Port Melbourne) — not managed by
--        the tenant, no active replacement. Hard delete the 4 orphan
--        assets AND the archived site row. Pre-check confirmed zero
--        dependent rows in acb_tests, nsx_tests, test_records,
--        testing_checks, maintenance_checks, defects, check_assets,
--        job_plan_items, contract_scopes, pm_calendar, site_contacts.
--
--    SY1 and SY4 archived site rows are left in place for audit trail.
--
-- 2) RPC HARDENING — get_assets_for_grouping
--    Add a filter so assets attached to an archived site are
--    excluded from the grouped view. This prevents the same
--    class of silent divergence from recurring. Assets with a
--    null site_id are still returned (they group under
--    "Unassigned" client-side, as today).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Reassign orphan assets
-- ------------------------------------------------------------

-- SY1 (archived, 47 Bourke Rd) → SY3 (active, 47 Bourke Rd)
with src as (
  select id from public.sites
   where name = 'SY1' and is_active = false and address ilike '%47 Bourke%'
),
dst as (
  select id from public.sites
   where name = 'SY3' and is_active = true and address ilike '%47 Bourke%'
)
update public.assets a
   set site_id = (select id from dst),
       updated_at = now()
  from src
 where a.site_id = src.id
   and a.is_active = true;

-- SY4 (archived, 17 Bourke Rd — data entry error) → SY4 (active, 200 Bourke Rd)
with src as (
  select id from public.sites
   where name = 'SY4' and is_active = false and address ilike '%17 Bourke%'
),
dst as (
  select id from public.sites
   where name = 'SY4' and is_active = true and address ilike '%200 Bourke%'
)
update public.assets a
   set site_id = (select id from dst),
       updated_at = now()
  from src
 where a.site_id = src.id
   and a.is_active = true;

-- MEL1 (archived, 826 Lorimer St) — not managed, hard delete orphan assets + site.
-- Pre-check confirmed zero dependent rows across all FK-referencing tables.
delete from public.assets
 where site_id = '08a43321-7b40-4c46-8458-156c9be84ee0'::uuid;

delete from public.sites
 where id = '08a43321-7b40-4c46-8458-156c9be84ee0'::uuid;

-- Sanity check: no active assets should remain attached to an archived site.
-- Raise an exception if any are found so the migration fails loudly instead
-- of leaving a partial fix in place.
do $$
declare
  orphan_count bigint;
begin
  select count(*)
    into orphan_count
    from public.assets a
    join public.sites s on s.id = a.site_id
   where a.is_active = true
     and s.is_active = false;

  if orphan_count > 0 then
    raise exception
      'Migration 0038: % active assets still attached to archived sites — aborting',
      orphan_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Harden get_assets_for_grouping to exclude assets attached
--    to archived sites. Unchanged: search, type, job plan, and
--    show_archived semantics (show_archived still only affects
--    the asset's own is_active flag, never the parent site).
-- ------------------------------------------------------------
create or replace function public.get_assets_for_grouping(
  p_show_archived boolean default false,
  p_search text default null,
  p_site_id uuid default null,
  p_asset_type text default null,
  p_job_plan_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'tenant_id', a.tenant_id,
        'site_id', a.site_id,
        'job_plan_id', a.job_plan_id,
        'name', a.name,
        'asset_type', a.asset_type,
        'serial_number', a.serial_number,
        'maximo_id', a.maximo_id,
        'location', a.location,
        'is_active', a.is_active,
        'created_at', a.created_at,
        'updated_at', a.updated_at,
        'sites', case when s.id is not null
                      then jsonb_build_object('name', s.name)
                      else null end,
        'job_plans', case when jp.id is not null
                          then jsonb_build_object('name', jp.name, 'code', jp.code)
                          else null end
      )
      order by a.name
    ),
    '[]'::jsonb
  )
    from public.assets a
    left join public.sites s on s.id = a.site_id
    left join public.job_plans jp on jp.id = a.job_plan_id
   where (p_show_archived or a.is_active = true)
     -- Exclude assets whose parent site is archived. Null site_id
     -- is still allowed through (grouped under "Unassigned").
     and (a.site_id is null or s.is_active = true)
     and (p_site_id is null or a.site_id = p_site_id)
     and (p_asset_type is null or a.asset_type = p_asset_type)
     and (p_job_plan_id is null or a.job_plan_id = p_job_plan_id)
     and (
       p_search is null
       or a.name ilike '%' || p_search || '%'
       or a.asset_type ilike '%' || p_search || '%'
       or a.serial_number ilike '%' || p_search || '%'
       or a.maximo_id ilike '%' || p_search || '%'
       or a.location ilike '%' || p_search || '%'
     );
$$;

comment on function public.get_assets_for_grouping(boolean, text, uuid, text, uuid) is
  'Returns all assets matching the given filters as a single jsonb array. '
  'Bypasses PostgREST db-max-rows cap by returning a scalar value instead of a row set. '
  'Excludes assets attached to archived (is_active = false) sites so the grouped '
  'view cannot diverge from the Sites page active asset count. '
  'Used by the Assets grouped view which needs the full result client-side.';

grant execute on function public.get_assets_for_grouping(boolean, text, uuid, text, uuid) to authenticated;
