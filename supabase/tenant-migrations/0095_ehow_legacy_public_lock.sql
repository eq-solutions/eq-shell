-- 0095: Lock down 15 legacy nspbmir-era public-schema tables on ehow that surface
-- as open authenticated grants in the drift check. IF EXISTS guards make this safe
-- to run on zaap (tables absent or already locked by 0059/0060).

DO $$
DECLARE
  t        text;
  pol_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_numbers', 'leave_requests', 'managers', 'people', 'prestarts',
    'project_targets', 'projects', 'regions', 'roster_presence', 'schedule',
    'site_diaries', 'sites', 'timesheet_locks', 'timesheets', 'toolbox_talks'
  ]
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);

    FOR pol_name IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY deny_all ON public.%I USING (false) WITH CHECK (false)', t
    );
  END LOOP;
END $$;
