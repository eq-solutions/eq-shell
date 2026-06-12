-- Migration: 0066_sks_comms_rls_policies
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Add tenant_id-scoped SELECT policies to the four sks_comms_* tables
--            on the ehow (SKS) plane. These tables have RLS enabled but no
--            permissive policies, making them deny-all for browser (authenticated)
--            callers. The drift check flags: RLS-on, zero tenant_id-scoped policies.
--
--            These tables exist on ehow only. On zaap all four DO blocks are
--            safe no-ops (IF EXISTS guard is false).
--
--            Policy: authenticated users may SELECT rows whose tenant_id matches
--            their JWT app_metadata claim. service_role bypasses RLS regardless.
--            No write policy is added here — writes go through service_role
--            Edge Functions per the canonical data path.

-- sks_comms_jobs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_jobs'
  ) THEN
    DROP POLICY IF EXISTS sks_comms_jobs_select_tenant ON app_data.sks_comms_jobs;
    CREATE POLICY sks_comms_jobs_select_tenant ON app_data.sks_comms_jobs
      FOR SELECT
      USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
  END IF;
END $$;

-- sks_comms_labour_rates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_labour_rates'
  ) THEN
    DROP POLICY IF EXISTS sks_comms_labour_rates_select_tenant ON app_data.sks_comms_labour_rates;
    CREATE POLICY sks_comms_labour_rates_select_tenant ON app_data.sks_comms_labour_rates
      FOR SELECT
      USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
  END IF;
END $$;

-- sks_comms_materials
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_materials'
  ) THEN
    DROP POLICY IF EXISTS sks_comms_materials_select_tenant ON app_data.sks_comms_materials;
    CREATE POLICY sks_comms_materials_select_tenant ON app_data.sks_comms_materials
      FOR SELECT
      USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
  END IF;
END $$;

-- sks_comms_po_lines
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_po_lines'
  ) THEN
    DROP POLICY IF EXISTS sks_comms_po_lines_select_tenant ON app_data.sks_comms_po_lines;
    CREATE POLICY sks_comms_po_lines_select_tenant ON app_data.sks_comms_po_lines
      FOR SELECT
      USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
  END IF;
END $$;
