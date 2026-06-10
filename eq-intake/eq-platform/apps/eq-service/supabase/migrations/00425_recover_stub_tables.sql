-- ============================================================
-- Migration 0042_a: Recover stub tables (briefs, contacts,
--   context_files, estimate_events, estimates)
--
-- 2026-05-15 BACKFILL NOTE
-- These five tables exist on prod but have no CREATE TABLE in any
-- migration in the repo. Same class of issue as 0004_test_records
-- (backfilled in PR #140) — the schemas were applied via the
-- Supabase Management API at the time and never committed.
--
-- Discovered when the new integration-tests CI workflow ran
-- `supabase start` against a fresh database: migration 0042
-- (fk_covering_indexes) failed at `CREATE INDEX … ON public.briefs`
-- because the table didn't exist.
--
-- This file is named `0042_a_` so it sorts after `0041_*` and
-- BEFORE `0042_fk_covering_indexes.sql` (alphabetical: `_a_` < `_fk_`),
-- which means the indexes 0042 declares can attach to the tables
-- we create here.
--
-- Schemas + indexes + constraints + RLS + triggers recovered from
-- prod via information_schema, pg_indexes, pg_constraint, pg_policies,
-- and pg_get_functiondef. Prod is unaffected — every CREATE uses
-- IF NOT EXISTS, every policy/trigger uses an idempotent guard.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. estimates — public intake form for the eq.solutions pricing tool
--    (anon writes; authenticated reads in admin views)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estimates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz DEFAULT now(),
  session_id         text,
  name               text NOT NULL,
  email              text NOT NULL,
  q1_problem         text NOT NULL,
  q2_team_size       text NOT NULL,
  q3_integrations    text NOT NULL,
  q4_customisation   text NOT NULL,
  q5_data_migration  text NOT NULL,
  q6_notes           text,
  answers            jsonb NOT NULL DEFAULT '{}'::jsonb,
  score              integer NOT NULL,
  tier               text NOT NULL,
  band               text NOT NULL,
  setup              integer,
  monthly            integer,
  price_range        text NOT NULL,
  timeframe          text NOT NULL,
  inclusions         text[] NOT NULL DEFAULT '{}'::text[],
  cta_clicked        text
);

CREATE INDEX IF NOT EXISTS idx_estimates_created_at ON public.estimates(created_at);

ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_estimates"  ON public.estimates;
DROP POLICY IF EXISTS "auth_select_estimates"  ON public.estimates;

CREATE POLICY "anon_insert_estimates" ON public.estimates
  FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "auth_select_estimates" ON public.estimates
  FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- 2. estimate_events — analytics breadcrumbs for the estimate flow
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estimate_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz DEFAULT now(),
  session_id  text NOT NULL,
  event       text NOT NULL,
  metadata    jsonb
);

CREATE INDEX IF NOT EXISTS idx_estimate_events_session_id ON public.estimate_events(session_id);

ALTER TABLE public.estimate_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_events" ON public.estimate_events;
DROP POLICY IF EXISTS "auth_select_events" ON public.estimate_events;

CREATE POLICY "anon_insert_events" ON public.estimate_events
  FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "auth_select_events" ON public.estimate_events
  FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- 3. briefs — follow-up free-text capture after an estimate
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.briefs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz DEFAULT now(),
  estimate_id  uuid REFERENCES public.estimates(id),
  brief_text   text NOT NULL,
  status       text DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS idx_briefs_estimate_id ON public.briefs(estimate_id);

ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_briefs" ON public.briefs;
DROP POLICY IF EXISTS "auth_select_briefs" ON public.briefs;

CREATE POLICY "anon_insert_briefs" ON public.briefs
  FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "auth_select_briefs" ON public.briefs
  FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- 4. contacts — generic customer/site contact registry (not the
--    customer_contacts or site_contacts tables; this one is the
--    consolidated "any contact" replacement)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
  customer_id  uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  site_id      uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  full_name    text NOT NULL,
  role         text,
  email        text,
  phone        text,
  mobile       text,
  is_primary   boolean DEFAULT false,
  notes        text,
  is_active    boolean DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id),
  CONSTRAINT contact_scope CHECK (customer_id IS NOT NULL OR site_id IS NOT NULL)
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can read contacts" ON public.contacts;
DROP POLICY IF EXISTS "Writers can insert contacts"     ON public.contacts;
DROP POLICY IF EXISTS "Writers can update contacts"     ON public.contacts;
DROP POLICY IF EXISTS "Writers can delete contacts"     ON public.contacts;

CREATE POLICY "Tenant members can read contacts" ON public.contacts
  FOR SELECT USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
       WHERE tm.user_id = (SELECT auth.uid())
         AND tm.is_active = true
    )
  );

CREATE POLICY "Writers can insert contacts" ON public.contacts
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
       WHERE tm.user_id = (SELECT auth.uid())
         AND tm.is_active = true
         AND tm.role = ANY(ARRAY['super_admin','admin','supervisor'])
    )
  );

CREATE POLICY "Writers can update contacts" ON public.contacts
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
       WHERE tm.user_id = (SELECT auth.uid())
         AND tm.is_active = true
         AND tm.role = ANY(ARRAY['super_admin','admin','supervisor'])
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
       WHERE tm.user_id = (SELECT auth.uid())
         AND tm.is_active = true
         AND tm.role = ANY(ARRAY['super_admin','admin','supervisor'])
    )
  );

CREATE POLICY "Writers can delete contacts" ON public.contacts
  FOR DELETE USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
       WHERE tm.user_id = (SELECT auth.uid())
         AND tm.is_active = true
         AND tm.role = ANY(ARRAY['super_admin','admin','supervisor'])
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 5. context_files — internal docs the AI assistant indexes
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.context_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  filename    text NOT NULL,
  content     text NOT NULL,
  updated_at  timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_context_files_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS context_files_set_updated_at ON public.context_files;
CREATE TRIGGER context_files_set_updated_at
  BEFORE UPDATE ON public.context_files
  FOR EACH ROW EXECUTE FUNCTION public.set_context_files_updated_at();

ALTER TABLE public.context_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read"          ON public.context_files;
DROP POLICY IF EXISTS "Service role write"   ON public.context_files;

CREATE POLICY "Public read" ON public.context_files
  FOR SELECT TO anon USING (true);

CREATE POLICY "Service role write" ON public.context_files
  FOR ALL TO service_role USING (true);
