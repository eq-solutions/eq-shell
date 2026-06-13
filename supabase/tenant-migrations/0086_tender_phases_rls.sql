-- Migration: 0086_tender_phases_rls
-- Target:    Per-tenant data plane (ehow + zaap + future tenants)
-- Purpose:   public.tender_phases is RLS-disabled AND grants SELECT to anon on the
--            tenant planes — an unauthenticated, cross-internet read of tenant tender
--            data. Revoke the anon grant, enable RLS, and add a tenant-isolation
--            policy keyed on org_id (the enforced isolation column for tender_*;
--            tender_phases has no tenant_id column). service_role (the canonical-api
--            data path) bypasses RLS, so the application path is unaffected.
--            Mirrors the tenant_iso pattern of 0083 (quote_rate_presets) and 0075/0076.
--
-- Idempotent: guarded so it is a no-op on a plane that lacks the table; REVOKE and
--             ENABLE ROW LEVEL SECURITY are safe to re-run; the policy is created only
--             if absent. Rollback is FIX-FORWARD only — never DISABLE RLS or re-GRANT
--             anon, which would re-open the exposure.

DO $$
BEGIN
  IF to_regclass('public.tender_phases') IS NULL THEN
    RAISE NOTICE 'tender_phases absent on this plane — skipping 0086';
    RETURN;
  END IF;

  REVOKE SELECT ON public.tender_phases FROM anon;

  ALTER TABLE public.tender_phases ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tender_phases'
      AND policyname = 'tenant_iso'
  ) THEN
    CREATE POLICY tenant_iso ON public.tender_phases
      USING (org_id = (
        (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid
      ));
  END IF;
END $$;
