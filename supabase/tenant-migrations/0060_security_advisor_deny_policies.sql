-- Migration: 0060_security_advisor_deny_policies
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Complete security-advisor cleanup after 0059:
--              1. REVOKE anon from ts_reminder_claim (zaap only — conditional)
--              2. Add explicit DENY ALL RLS policies on all service_role-only tables
--                 to silence rls_enabled_no_policy INFO advisories.
--              3. REVOKE anon/authenticated + add DENY on untouched tables that
--                 now surface rls_enabled_no_policy after 0059.
--
-- WHY DENY POLICIES:
--   REVOKE alone silences the real threat but the advisor still fires because
--   it checks for RLS + 0 policies regardless of grants. A USING(false)
--   policy makes the posture explicit and clears the advisory.
--   service_role bypasses RLS regardless, so service_role access is unaffected.

-- ─── ts_reminder_claim anon access (zaap only) ────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ts_reminder_claim'
  ) THEN
    REVOKE ALL ON FUNCTION
      public.ts_reminder_claim(uuid, text, text, text, text, numeric)
      FROM anon;
  END IF;
END $$;

-- ─── Deny policies: tables treated in 0059 (zaap) ─────────────────────────
-- Already REVOKE'd — just need the deny policy to clear the advisory.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'prestarts') THEN
    DROP POLICY IF EXISTS deny_all ON public.prestarts;
    CREATE POLICY deny_all ON public.prestarts USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_targets') THEN
    DROP POLICY IF EXISTS deny_all ON public.project_targets;
    CREATE POLICY deny_all ON public.project_targets USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'projects') THEN
    DROP POLICY IF EXISTS deny_all ON public.projects;
    CREATE POLICY deny_all ON public.projects USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'regions') THEN
    DROP POLICY IF EXISTS deny_all ON public.regions;
    CREATE POLICY deny_all ON public.regions USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'roster_presence') THEN
    DROP POLICY IF EXISTS deny_all ON public.roster_presence;
    CREATE POLICY deny_all ON public.roster_presence USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rotations') THEN
    DROP POLICY IF EXISTS deny_all ON public.rotations;
    CREATE POLICY deny_all ON public.rotations USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'site_diaries') THEN
    DROP POLICY IF EXISTS deny_all ON public.site_diaries;
    CREATE POLICY deny_all ON public.site_diaries USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'skills_ratings') THEN
    DROP POLICY IF EXISTS deny_all ON public.skills_ratings;
    CREATE POLICY deny_all ON public.skills_ratings USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'timesheet_locks') THEN
    DROP POLICY IF EXISTS deny_all ON public.timesheet_locks;
    CREATE POLICY deny_all ON public.timesheet_locks USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'toolbox_talks') THEN
    DROP POLICY IF EXISTS deny_all ON public.toolbox_talks;
    CREATE POLICY deny_all ON public.toolbox_talks USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ─── Deny policies: additional zaap tables with rls_enabled_no_policy ──────
-- These tables weren't touched in 0059. Apply REVOKE + deny policy.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'apprentice_journal') THEN
    REVOKE ALL ON public.apprentice_journal FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.apprentice_journal TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.apprentice_journal;
    CREATE POLICY deny_all ON public.apprentice_journal USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'apprentice_profiles') THEN
    REVOKE ALL ON public.apprentice_profiles FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.apprentice_profiles TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.apprentice_profiles;
    CREATE POLICY deny_all ON public.apprentice_profiles USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.audit_log;
    CREATE POLICY deny_all ON public.audit_log USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feedback_entries') THEN
    REVOKE ALL ON public.feedback_entries FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_entries TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.feedback_entries;
    CREATE POLICY deny_all ON public.feedback_entries USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feedback_requests') THEN
    REVOKE ALL ON public.feedback_requests FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_requests TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.feedback_requests;
    CREATE POLICY deny_all ON public.feedback_requests USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'job_numbers') THEN
    REVOKE ALL ON public.job_numbers FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_numbers TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.job_numbers;
    CREATE POLICY deny_all ON public.job_numbers USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leave_requests') THEN
    REVOKE ALL ON public.leave_requests FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.leave_requests;
    CREATE POLICY deny_all ON public.leave_requests USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'managers') THEN
    REVOKE ALL ON public.managers FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.managers TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.managers;
    CREATE POLICY deny_all ON public.managers USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'people') THEN
    REVOKE ALL ON public.people FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.people;
    CREATE POLICY deny_all ON public.people USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rate_limit_buckets') THEN
    REVOKE ALL ON public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_buckets TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.rate_limit_buckets;
    CREATE POLICY deny_all ON public.rate_limit_buckets USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedule') THEN
    REVOKE ALL ON public.schedule FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.schedule;
    CREATE POLICY deny_all ON public.schedule USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sites') THEN
    REVOKE ALL ON public.sites FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.sites;
    CREATE POLICY deny_all ON public.sites USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'timesheets') THEN
    REVOKE ALL ON public.timesheets FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheets TO service_role;
    DROP POLICY IF EXISTS deny_all ON public.timesheets;
    CREATE POLICY deny_all ON public.timesheets USING (false) WITH CHECK (false);
  END IF;
END $$;

-- app_data internal tables (migration tracking — definitely service_role only)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_data' AND table_name = '_eq_migrations') THEN
    REVOKE ALL ON app_data._eq_migrations FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_data._eq_migrations TO service_role;
    DROP POLICY IF EXISTS deny_all ON app_data._eq_migrations;
    CREATE POLICY deny_all ON app_data._eq_migrations USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_data' AND table_name = 'migration_baseline') THEN
    REVOKE ALL ON app_data.migration_baseline FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_data.migration_baseline TO service_role;
    DROP POLICY IF EXISTS deny_all ON app_data.migration_baseline;
    CREATE POLICY deny_all ON app_data.migration_baseline USING (false) WITH CHECK (false);
  END IF;
END $$;
