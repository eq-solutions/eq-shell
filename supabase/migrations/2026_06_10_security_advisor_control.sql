-- Migration: 2026_06_10_security_advisor_control
-- Target:    eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Silence Supabase security-advisor warnings:
--              - anon_security_definer_function_executable  (WARN)
--              - rls_enabled_no_policy                      (INFO)
--
-- SECTION A — SECURITY DEFINER functions callable by anon
--   fn_link_shell_user_on_worker_upsert: trigger function — never called
--     directly by clients. Revoke from anon AND authenticated.
--   eq_cards_delete_account: account deletion — requires authenticated session.
--     Revoke from anon.
--   eq_cards_get_worker_hr_record: HR data fetch — requires authenticated session.
--     Revoke from anon.
--   eq_cards_claim_invite / eq_cards_preview_invite: onboarding flow.
--     These are called via Edge Functions (service_role), not direct client RPC.
--     Revoke from anon. If any future flow needs direct anon RPC, re-grant
--     narrowly and document here.
--
-- SECTION B — shell_control tables: RLS enabled, no policy
--   All shell_control.* tables are internal control-plane data accessed
--   exclusively via Edge Functions using service_role. service_role bypasses
--   RLS regardless, so no policies are needed — just REVOKE from anon/authenticated.
--   public.tenants is the canonical tenant registry, same access model.

-- ─── SECTION A: SECURITY DEFINER function lockdown ────────────────────────

-- Trigger function — no direct client call should ever reach this
REVOKE ALL ON FUNCTION public.fn_link_shell_user_on_worker_upsert()
  FROM anon, authenticated;

-- shell_control trigger — may not exist on all environments; guard it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'shell_control' AND p.proname = 'fn_link_worker_on_user_create'
  ) THEN
    REVOKE ALL ON FUNCTION shell_control.fn_link_worker_on_user_create()
      FROM anon, authenticated;
  END IF;
END $$;

-- Account deletion — requires authenticated session
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_delete_account'
  ) THEN
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_delete_account('
             || pg_get_function_arguments(p.oid)
             || ') FROM anon'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_delete_account'
      LIMIT 1
    );
  END IF;
END $$;

-- HR record — requires authenticated session
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_get_worker_hr_record'
  ) THEN
    -- Revoke from any signature variant
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_get_worker_hr_record('
             || string_agg(pg_get_function_arguments(p.oid), ', ')
             || ') FROM anon'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_get_worker_hr_record'
      GROUP BY p.oid
      LIMIT 1
    );
  END IF;
END $$;

-- Onboarding functions — called via Edge Functions (service_role), not direct anon RPC
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_claim_invite'
  ) THEN
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_claim_invite('
             || pg_get_function_arguments(p.oid)
             || ') FROM anon'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_claim_invite'
      LIMIT 1
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_preview_invite'
  ) THEN
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_preview_invite('
             || pg_get_function_arguments(p.oid)
             || ') FROM anon'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_preview_invite'
      LIMIT 1
    );
  END IF;
END $$;

-- ─── SECTION B: shell_control + public.tenants lockdown ───────────────────
-- REVOKE ALL + explicit service_role GRANT for each internal table.
-- RLS remains enabled (service_role bypasses it; no policies = deny all others).

-- public.tenants
REVOKE ALL ON public.tenants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO service_role;

-- shell_control tables
REVOKE ALL ON shell_control.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.audit_log TO service_role;

REVOKE ALL ON shell_control.cards_field_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.cards_field_approvals TO service_role;

REVOKE ALL ON shell_control.pin_reset_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.pin_reset_tokens TO service_role;

REVOKE ALL ON shell_control.platform_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.platform_config TO service_role;

REVOKE ALL ON shell_control.provision_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.provision_tokens TO service_role;

REVOKE ALL ON shell_control.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.rate_limit_buckets TO service_role;

REVOKE ALL ON shell_control.security_group_perms FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.security_group_perms TO service_role;

REVOKE ALL ON shell_control.security_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.security_groups TO service_role;

REVOKE ALL ON shell_control.tenant_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.tenant_config TO service_role;

REVOKE ALL ON shell_control.tenant_role_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.tenant_role_overrides TO service_role;

REVOKE ALL ON shell_control.tenant_routing FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.tenant_routing TO service_role;

REVOKE ALL ON shell_control.user_security_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shell_control.user_security_groups TO service_role;
