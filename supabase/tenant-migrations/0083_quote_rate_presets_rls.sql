-- Migration: 0083_quote_rate_presets_rls
-- Target:    Per-tenant data plane (ehow + zaap + future tenants)
-- Purpose:   Close the spine-RLS invariant gap. 0071_quote_rate_presets created
--            app_data.quote_rate_presets but never enabled RLS or added a tenant
--            policy, so the table is RLS-disabled on the tenant planes — which
--            fails scripts/check-tenant-drift.mjs (spine RLS invariant + the
--            tenant-isolation policy lint). No later migration (0072–0082) adds
--            it. This migration enables RLS + a tenant-isolation policy, mirroring
--            the `tenant_iso` pattern used by quote_templates (0075) and the
--            pricing_* tables (0076).
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is safe to re-run; the policy is guarded
-- by an IF NOT EXISTS check on pg_policies.

ALTER TABLE app_data.quote_rate_presets
  ENABLE ROW LEVEL SECURITY;

-- RLS: tenant-scoped (service role bypasses). USING also governs INSERT/UPDATE
-- (Postgres applies USING as WITH CHECK when WITH CHECK is omitted), matching
-- the other quote/pricing tables.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'quote_rate_presets' AND policyname = 'tenant_iso'
  ) THEN
    CREATE POLICY tenant_iso ON app_data.quote_rate_presets
      USING (tenant_id = (
        (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid
      ));
  END IF;
END $$;
