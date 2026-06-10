-- ============================================================
-- Migration 0079: Security advisor hardening for 0073 + 0077 objects
--
-- Resolves the three new advisor findings introduced by 0073 (cpi view) and
-- 0077 (scope_coverage_gaps trigger fns):
--
-- 1. ERROR security_definer_view (lint 0010) on contract_scopes_with_cpi --
--    Supabase treats views owned by superuser + RLS-bearing underlying tables
--    as effective SECURITY DEFINER. Switch to security_invoker = true so the
--    caller's RLS applies when reading through the view.
--
-- 2. WARN function_search_path_mutable (lint 0011) on
--    set_scope_coverage_gap_severity -- pin search_path so a malicious
--    schema-on-search-path can't shadow a referenced function/operator.
--
-- 3. WARN anon/authenticated_security_definer_function_executable (lints
--    0028/0029) on the two new trigger functions -- they're called only via
--    BEFORE INSERT/UPDATE triggers, never as RPC. Revoke EXECUTE from the
--    PostgREST-exposed roles so the /rest/v1/rpc/* surface doesn't list them.
-- ============================================================

ALTER VIEW public.contract_scopes_with_cpi SET (security_invoker = true);

ALTER FUNCTION public.set_scope_coverage_gap_severity()
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.set_scope_coverage_gap_severity()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_scope_coverage_gap_accept_role()
  FROM PUBLIC, anon, authenticated;
