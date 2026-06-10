-- Migration: 0052_import_rls_initplan_fix
-- Purpose:   Wrap auth.uid() in the INSERT WITH CHECK policies for
--            import_sessions and import_overrides so the planner evaluates
--            it once per query instead of once per row (auth_rls_initplan
--            WARN from Supabase advisors after 0051 landed).
-- Applied:   2026-04-19 to project urjhmkhbgaxrofurpbgc via Supabase MCP.
-- Note:      Only `auth.uid()` is wrapped — `public.get_user_tenant_ids()`
--            is intentionally NOT wrapped here (see migration 0051 header
--            comment: wrapping the array-returning function in a subquery
--            blows up with `operator does not exist: uuid = uuid[]`).

BEGIN;

DROP POLICY IF EXISTS import_sessions_insert ON public.import_sessions;
CREATE POLICY import_sessions_insert
  ON public.import_sessions FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
    AND created_by = (select auth.uid())
  );

DROP POLICY IF EXISTS import_overrides_insert ON public.import_overrides;
CREATE POLICY import_overrides_insert
  ON public.import_overrides FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
    AND created_by = (select auth.uid())
  );

COMMIT;
