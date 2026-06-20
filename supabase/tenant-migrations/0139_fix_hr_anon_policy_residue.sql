-- 0139: Fix residue from 0138.
--
-- 0138 committed to the ledger but its inner DO block failed at the DROP POLICY
-- step (the 14 HR/apprentice tables already had explicit anon-allow policies —
-- anon_select/anon_insert/anon_update/anon_delete — that did not get dropped).
-- Because the DO block and the ledger INSERT run as separate statements via the
-- Management API, the INSERT landed even though the DDL rolled back. The result:
-- all 14 tables are marked applied but still have open anon access.
--
-- Fix strategy — two independent DO blocks so REVOKE cannot be rolled back by
-- a policy-drop failure:
--   Block 1: drop the known named policies, wrapped in per-iteration EXCEPTION
--            handlers so a single failure does not abort the outer loop.
--   Block 2: REVOKE ALL from anon/authenticated, GRANT to service_role, and add
--            a RESTRICTIVE deny_all policy if one does not already exist.
--            This block runs regardless of Block 1's outcome.
--
-- IF EXISTS guards make both blocks no-ops on zaap where these tables are absent.

-- ── Block 1: drop the named open policies ──────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'apprentice_journal', 'apprentice_profiles', 'buddy_checkins', 'checkins',
    'competencies', 'engagement_log', 'feedback_entries', 'feedback_requests',
    'people_notes', 'quarterly_reviews', 'rotations', 'skills_ratings',
    'supervisor_notes'
  ]
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    );
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS anon_select ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS anon_insert ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS anon_update ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS anon_delete ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS deny_all    ON public.%I', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '0139 DROP POLICY skipped for %: %', t, SQLERRM;
    END;
  END LOOP;

  -- acknowledgments uses different policy names
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'acknowledgments'
  ) THEN
    BEGIN
      DROP POLICY IF EXISTS anon_select               ON public.acknowledgments;
      DROP POLICY IF EXISTS anon_insert               ON public.acknowledgments;
      DROP POLICY IF EXISTS anon_update               ON public.acknowledgments;
      DROP POLICY IF EXISTS anon_delete               ON public.acknowledgments;
      DROP POLICY IF EXISTS acknowledgments_select     ON public.acknowledgments;
      DROP POLICY IF EXISTS acknowledgments_modify_authed ON public.acknowledgments;
      DROP POLICY IF EXISTS deny_all                  ON public.acknowledgments;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '0139 DROP POLICY skipped for acknowledgments: %', SQLERRM;
    END;
  END IF;
END $$;

-- ── Block 2: revoke grants + enforce deny_all (independent of Block 1) ─────────
DO $$
DECLARE
  t text;
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

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Add deny_all only if none exists yet (Block 1 may have cleared the way,
    -- or a previous partial run may have already created it)
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'deny_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY deny_all ON public.%I AS RESTRICTIVE USING (false) WITH CHECK (false)', t
      );
    END IF;
  END LOOP;
END $$;
