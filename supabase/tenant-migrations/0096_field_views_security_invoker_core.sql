-- Migration: 0096_field_views_security_invoker_core
-- Purpose:   Forward fix for planes where 0084 failed because some field_*
--            objects are tables, not views (e.g. field_site_diaries on zaap).
--            Guards each ALTER VIEW behind a pg_views existence check.
--            Idempotent — SET (security_invoker = true) on an already-set view is a no-op.

DO $$
DECLARE
  v record;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('app_data', 'field_site_diaries'),
    ('app_data', 'field_schedule'),
    ('app_data', 'field_timesheets'),
    ('app_data', 'field_leave_requests'),
    ('app_data', 'field_audit_log'),
    ('app_data', 'field_prestarts'),
    ('app_data', 'field_toolbox_talks'),
    ('public',   'nomination_clashes')
  ) AS t(schemaname, viewname)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_views
      WHERE schemaname = v.schemaname AND viewname = v.viewname
    ) THEN
      EXECUTE format(
        'ALTER VIEW %I.%I SET (security_invoker = true)',
        v.schemaname, v.viewname
      );
    END IF;
  END LOOP;
END $$;
