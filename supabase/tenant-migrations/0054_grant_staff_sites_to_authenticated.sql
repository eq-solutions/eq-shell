-- 0054_grant_staff_sites_to_authenticated.sql
--
-- field_people and field_sites are security_invoker views — the caller
-- (authenticated role) must have SELECT on the underlying tables for the
-- view to work. Migration 0052/0050 only granted on the views themselves.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'staff'
  ) THEN
    EXECUTE 'GRANT SELECT ON app_data.staff TO authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sites'
  ) THEN
    EXECUTE 'GRANT SELECT ON app_data.sites TO authenticated';
  END IF;
END $$;
