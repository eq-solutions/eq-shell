-- Migration: 0084_field_views_security_invoker
-- Target:    Per-tenant data plane
-- Purpose:   Security fix — make the EQ Field reporting views enforce the querying
--            user's RLS instead of the view owner's.
--
--   Supabase security advisor (rule 0010, security_definer_view, ERROR) flagged 8
--   views that run with the definer's privileges, bypassing the caller's row-level
--   security on the underlying tables. Verified safe to switch to SECURITY INVOKER:
--   every base table already has RLS enabled with an authenticated-applicable policy
--   AND grants SELECT to `authenticated`, so EQ Field's signed-in, tenant-scoped reads
--   keep working — and now get correctly filtered per tenant at query time instead of
--   relying on the view to (not) filter.
--
--   Owned by eq-shell tenant-migrations (created in 0050/0052/0055/0057), so this is
--   the correct place to fix them.
--
-- Idempotent (SET (security_invoker = true) is repeatable).
-- Guarded: on planes where these objects are BASE TABLEs (not views), the ALTER VIEW
-- is skipped rather than failing with 42809. On planes where they don't exist at all
-- (e.g. nomination_clashes absent on zaap), the pg_views check skips cleanly.

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
