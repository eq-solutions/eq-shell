-- Migration: 0066_sks_comms_rls_policies
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Lock down the four sks_comms_* tables on ehow. These tables have no
--            tenant_id column (pre-canonical, single-tenant design) so the standard
--            tenant_id-scoped SELECT policy approach does not apply. Instead, revoke
--            the open authenticated grant and rely on service_role for any future
--            access path.
--
--            Tables exist on ehow only. On zaap all four DO blocks are no-ops
--            (IF EXISTS guard is false — tables were never created there).

-- sks_comms_jobs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_jobs'
  ) THEN
    REVOKE ALL ON app_data.sks_comms_jobs FROM authenticated;
    REVOKE ALL ON app_data.sks_comms_jobs FROM anon;
  END IF;
END $$;

-- sks_comms_labour_rates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_labour_rates'
  ) THEN
    REVOKE ALL ON app_data.sks_comms_labour_rates FROM authenticated;
    REVOKE ALL ON app_data.sks_comms_labour_rates FROM anon;
  END IF;
END $$;

-- sks_comms_materials
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_materials'
  ) THEN
    REVOKE ALL ON app_data.sks_comms_materials FROM authenticated;
    REVOKE ALL ON app_data.sks_comms_materials FROM anon;
  END IF;
END $$;

-- sks_comms_po_lines
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sks_comms_po_lines'
  ) THEN
    REVOKE ALL ON app_data.sks_comms_po_lines FROM authenticated;
    REVOKE ALL ON app_data.sks_comms_po_lines FROM anon;
  END IF;
END $$;
