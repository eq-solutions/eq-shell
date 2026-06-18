-- 0138: Lock down 14 HR/apprentice public-schema tables on ehow that have
-- unconstrained anon access. IF EXISTS guards make this safe to run on zaap
-- (tables absent) without effect.

DO $$
DECLARE
  t        text;
  pol_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'acknowledgments', 'apprentice_journal', 'apprentice_profiles',
    'buddy_checkins', 'checkins', 'competencies', 'engagement_log',
    'feedback_entries', 'feedback_requests', 'people_notes',
    'quarterly_reviews', 'rotations', 'skills_ratings', 'supervisor_notes'
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
