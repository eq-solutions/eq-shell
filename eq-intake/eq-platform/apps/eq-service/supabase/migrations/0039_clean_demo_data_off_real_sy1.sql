-- ============================================================
-- 0039_clean_demo_data_off_real_sy1.sql
--
-- Active SY1 (2895df55..., 639 Gardeners Rd, Mascot) is a real
-- imported Equinix site. After 0038 it has zero assets, which
-- is correct — but it still has leftover demo/test rows that
-- need to come off before it can be used for real data.
--
-- 1) 15 pm_calendar rows for SY1 all created at the exact same
--    microsecond (2026-04-10 06:31:00.879416+00). They form a
--    full FY2025-26 PM program (Management Q1-Q4, Quarterly
--    Maintenance Q1-Q4, Emergency Lighting, Thermal Scanning,
--    RCD, Dark Site, Test and Tag). Identical timestamp
--    confirms a seed script. Hard delete — filter is surgical
--    (site_id + exact created_at).
--
-- 2) 1 maintenance_checks row (955dcf82-...) with
--    custom_name = 'Test', status = 'cancelled', job_plan_id
--    = null, created 2026-04-15 (today). UI poke, safe to drop.
--
-- Pre-check confirmed zero dependents:
--   - pm_calendar.recurrence_parent_id children: 0
--   - maintenance_check_items (via check_id): 0
--   - check_assets (via check_id): 0
--   - defects (via check_id): 0
--
-- Hard delete is appropriate here because:
--   - this is seed/test cruft, not real business data
--   - soft-deleting would leave it visible via show_archived=1
--   - Royce explicitly asked for cleanup before real data lands
-- ============================================================

-- 1) Demo PM calendar on active SY1
delete from public.pm_calendar
 where site_id = '2895df55-3585-4ba3-a015-7e0548dab228'::uuid
   and created_at = '2026-04-10 06:31:00.879416+00'::timestamptz;

-- 2) "Test" maintenance_check on active SY1
delete from public.maintenance_checks
 where id = '955dcf82-bde1-4f5f-a7cf-d2032cb59db3'::uuid
   and site_id = '2895df55-3585-4ba3-a015-7e0548dab228'::uuid
   and custom_name = 'Test';

-- Sanity: active SY1 should now have zero assets, pm_calendar
-- rows, and maintenance_checks. Fail loudly if anything remains.
do $$
declare
  n_assets bigint;
  n_pm bigint;
  n_checks bigint;
begin
  select count(*) into n_assets
    from public.assets
   where site_id = '2895df55-3585-4ba3-a015-7e0548dab228'::uuid
     and is_active = true;

  select count(*) into n_pm
    from public.pm_calendar
   where site_id = '2895df55-3585-4ba3-a015-7e0548dab228'::uuid;

  select count(*) into n_checks
    from public.maintenance_checks
   where site_id = '2895df55-3585-4ba3-a015-7e0548dab228'::uuid;

  if n_assets > 0 or n_pm > 0 or n_checks > 0 then
    raise exception
      'Migration 0039: active SY1 not clean — assets=%, pm_calendar=%, maintenance_checks=%',
      n_assets, n_pm, n_checks;
  end if;
end $$;
