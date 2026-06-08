-- 0055_field_managers_and_locks_views.sql
--
-- field_managers: Field's managers table surface, backed by app_data.staff.
--   Shape matches legacy public.managers: id, name, category, phone, email, archived.
--   All active staff are eligible as managers on the canonical path — the
--   Supervision page / gate dropdown uses this list. security_invoker=on so the
--   tenant_isolation RLS on staff filters by JWT tenant_id.
--
-- field_timesheet_locks: passthrough view over app_data.timesheet_locks.
--   Field uses this to check/set week locks before timesheet submission.
--   security_invoker=on; authenticated already has access via 0054 for staff,
--   but timesheet_locks needs its own grant.

DO $$
BEGIN
  -- ── field_managers ───────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'staff'
  ) THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW app_data.field_managers AS
      SELECT
        staff_id                                                        AS id,
        tenant_id,
        COALESCE(preferred_name, first_name || ' ' || last_name)        AS name,
        employment_type                                                  AS category,
        phone,
        email,
        (active IS NOT TRUE)                                            AS archived,
        created_at,
        updated_at
      FROM app_data.staff
      WHERE active IS NOT FALSE;
    $sql$;

    EXECUTE $sql$
      ALTER VIEW app_data.field_managers SET (security_invoker = on);
    $sql$;

    EXECUTE $sql$
      GRANT SELECT ON app_data.field_managers TO authenticated;
    $sql$;
  END IF;

  -- ── field_timesheet_locks ────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'timesheet_locks'
  ) THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW app_data.field_timesheet_locks AS
      SELECT * FROM app_data.timesheet_locks;
    $sql$;

    EXECUTE $sql$
      ALTER VIEW app_data.field_timesheet_locks SET (security_invoker = on);
    $sql$;

    EXECUTE $sql$
      GRANT SELECT, INSERT, UPDATE, DELETE ON app_data.field_timesheet_locks TO authenticated;
    $sql$;

    EXECUTE $sql$
      GRANT SELECT, INSERT, UPDATE, DELETE ON app_data.timesheet_locks TO authenticated;
    $sql$;
  END IF;
END $$;
