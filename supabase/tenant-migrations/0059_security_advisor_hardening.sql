-- Migration: 0059_security_advisor_hardening
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Silence Supabase security-advisor warnings:
--              - anon_security_definer_function_executable  (WARN)
--              - rls_policy_always_true                     (WARN)
--
-- SECTION A — credential functions (ehowg / sks-canonical only)
--   These three functions exist only on the ehowg plane.
--   On zaap the IF EXISTS guards make each block a safe no-op.
--   _admin_rekey_site_credential: admin utility — no JWT check inside.
--     Revoke from anon AND authenticated; only service_role should call it.
--   decrypt_site_credential / upsert_site_credential: have internal JWT
--     tenant checks but are still flagged because anon has EXECUTE.
--     Revoke from anon; authenticated users legitimately call these via RPC.
--
-- SECTION B — always-true RLS policies (zaap / eq-canonical-internal only)
--   zaap is the server-only tenant data plane — all writes go through Edge
--   Functions using service_role. The always-true policies on {public} mean
--   any anon token can read/write across all orgs. Fix: drop the bad policies
--   and REVOKE from PUBLIC/anon/authenticated; GRANT to service_role only.
--   On ehowg these tables do not exist so the IF EXISTS guards are no-ops.

-- ─── SECTION A: ehowg credential functions ────────────────────────────────

DO $$
BEGIN
  -- _admin_rekey_site_credential — no JWT check, admin-only
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_admin_rekey_site_credential'
  ) THEN
    REVOKE ALL ON FUNCTION public._admin_rekey_site_credential(uuid, text)
      FROM anon, authenticated;
  END IF;

  -- decrypt_site_credential — has JWT tenant check; revoke anon only
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'decrypt_site_credential'
  ) THEN
    REVOKE ALL ON FUNCTION public.decrypt_site_credential(uuid, text) FROM anon;
  END IF;

  -- upsert_site_credential — has JWT tenant check; revoke anon only
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_site_credential'
  ) THEN
    REVOKE ALL ON FUNCTION
      public.upsert_site_credential(uuid, uuid, uuid, text, text, text, text, text, text, uuid)
      FROM anon;
  END IF;
END $$;

-- ─── SECTION B: zaap always-true RLS policies ─────────────────────────────
-- Pattern per table:
--   1. DROP always-true policies (IF EXISTS — safe no-op on ehowg)
--   2. REVOKE ALL from PUBLIC, anon, authenticated
--   3. GRANT full DML to service_role
-- service_role bypasses RLS regardless, so no policy is needed for it.

-- prestarts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prestarts'
  ) THEN
    DROP POLICY IF EXISTS prestarts_select_tenant ON public.prestarts;
    DROP POLICY IF EXISTS prestarts_insert_tenant ON public.prestarts;
    DROP POLICY IF EXISTS prestarts_update_tenant ON public.prestarts;
    DROP POLICY IF EXISTS prestarts_delete_tenant ON public.prestarts;
    REVOKE ALL ON public.prestarts FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.prestarts TO service_role;
  END IF;
END $$;

-- project_targets
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'project_targets'
  ) THEN
    DROP POLICY IF EXISTS project_targets_anon_select ON public.project_targets;
    DROP POLICY IF EXISTS project_targets_anon_insert ON public.project_targets;
    DROP POLICY IF EXISTS project_targets_anon_update ON public.project_targets;
    DROP POLICY IF EXISTS project_targets_anon_delete ON public.project_targets;
    REVOKE ALL ON public.project_targets FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_targets TO service_role;
  END IF;
END $$;

-- projects
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'projects'
  ) THEN
    DROP POLICY IF EXISTS projects_anon_select ON public.projects;
    DROP POLICY IF EXISTS projects_anon_insert ON public.projects;
    DROP POLICY IF EXISTS projects_anon_update ON public.projects;
    DROP POLICY IF EXISTS projects_anon_delete ON public.projects;
    REVOKE ALL ON public.projects FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO service_role;
  END IF;
END $$;

-- regions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'regions'
  ) THEN
    DROP POLICY IF EXISTS regions_anon_select ON public.regions;
    DROP POLICY IF EXISTS regions_anon_insert ON public.regions;
    DROP POLICY IF EXISTS regions_anon_update ON public.regions;
    DROP POLICY IF EXISTS regions_anon_delete ON public.regions;
    REVOKE ALL ON public.regions FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.regions TO service_role;
  END IF;
END $$;

-- roster_presence
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'roster_presence'
  ) THEN
    DROP POLICY IF EXISTS presence_select_anon ON public.roster_presence;
    DROP POLICY IF EXISTS presence_insert_anon ON public.roster_presence;
    DROP POLICY IF EXISTS presence_update_anon ON public.roster_presence;
    DROP POLICY IF EXISTS presence_delete_anon ON public.roster_presence;
    REVOKE ALL ON public.roster_presence FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.roster_presence TO service_role;
  END IF;
END $$;

-- rotations
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rotations'
  ) THEN
    DROP POLICY IF EXISTS rot_anon_select ON public.rotations;
    DROP POLICY IF EXISTS rot_anon_insert ON public.rotations;
    DROP POLICY IF EXISTS rot_anon_update ON public.rotations;
    DROP POLICY IF EXISTS rot_anon_delete ON public.rotations;
    REVOKE ALL ON public.rotations FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.rotations TO service_role;
  END IF;
END $$;

-- site_diaries
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_diaries'
  ) THEN
    DROP POLICY IF EXISTS site_diaries_select_tenant ON public.site_diaries;
    DROP POLICY IF EXISTS site_diaries_insert_tenant ON public.site_diaries;
    DROP POLICY IF EXISTS site_diaries_update_tenant ON public.site_diaries;
    DROP POLICY IF EXISTS site_diaries_delete_tenant ON public.site_diaries;
    REVOKE ALL ON public.site_diaries FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_diaries TO service_role;
  END IF;
END $$;

-- skills_ratings
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'skills_ratings'
  ) THEN
    DROP POLICY IF EXISTS sr_anon_select ON public.skills_ratings;
    DROP POLICY IF EXISTS sr_anon_insert ON public.skills_ratings;
    DROP POLICY IF EXISTS sr_anon_update ON public.skills_ratings;
    DROP POLICY IF EXISTS sr_anon_delete ON public.skills_ratings;
    REVOKE ALL ON public.skills_ratings FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_ratings TO service_role;
  END IF;
END $$;

-- timesheet_locks
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'timesheet_locks'
  ) THEN
    DROP POLICY IF EXISTS timesheet_locks_select_tenant ON public.timesheet_locks;
    DROP POLICY IF EXISTS timesheet_locks_insert_tenant ON public.timesheet_locks;
    DROP POLICY IF EXISTS timesheet_locks_update_tenant ON public.timesheet_locks;
    DROP POLICY IF EXISTS timesheet_locks_delete_tenant ON public.timesheet_locks;
    REVOKE ALL ON public.timesheet_locks FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheet_locks TO service_role;
  END IF;
END $$;

-- toolbox_talks
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'toolbox_talks'
  ) THEN
    DROP POLICY IF EXISTS toolbox_talks_select_tenant ON public.toolbox_talks;
    DROP POLICY IF EXISTS toolbox_talks_insert_tenant ON public.toolbox_talks;
    DROP POLICY IF EXISTS toolbox_talks_update_tenant ON public.toolbox_talks;
    DROP POLICY IF EXISTS toolbox_talks_delete_tenant ON public.toolbox_talks;
    REVOKE ALL ON public.toolbox_talks FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.toolbox_talks TO service_role;
  END IF;
END $$;
