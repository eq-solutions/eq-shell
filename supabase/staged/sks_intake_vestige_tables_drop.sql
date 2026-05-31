-- sks_intake_vestige_tables_drop.sql
-- Target:  ehowgjardagevnrluult (SKS tenant — ehowg)
-- Gate:    🔒 Royce sign-off required before applying
-- Status:  🟡 staged — safe to apply, no data loss
--
-- WHY
-- These tables are vestiges of the pre-silo architecture when eq_intake_*
-- scaffolding was provisioned directly on each tenant's shell_control schema.
-- The current two-plane model moves all intake coordination to the
-- eq-canonical control plane (jvkn); these tables are unreferenced on ehowg.
-- 0027_drop_intake_vestiges.sql already dropped the RPC functions; this
-- drops the backing tables.
--
-- DATA SNAPSHOT (confirmed via MCP 2026-06-01 before migration was authored)
-- shell_control.eq_intake_events contained 5 rows, all smoke-test runs from
-- 2026-05-26, all status='rolled_back', tenant_id='a1b2c3d4-0000-0000-0000-000000000001'
-- (dummy UUID). Safe to discard.
-- All other tables below were confirmed empty (0 rows).
--
-- TABLES DROPPED
-- schema              | table                    | rows at snapshot
-- shell_control       | eq_intake_events         | 5 (all rolled_back smoke tests)
-- shell_control       | eq_intake_templates      | 0
-- shell_control       | eq_intake_row_audit      | 0
-- app_data            | eq_intake_rate_limits    | 0
--
-- APPLY
--   Supabase MCP: apply_migration on project ehowgjardagevnrluult
--   Or: paste into Supabase SQL editor on project ehowgjardagevnrluult

BEGIN;

-- Confirm we are on the right project before dropping anything.
-- This will raise if the table doesn't exist (double-check before apply).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'shell_control'
      AND table_name   = 'eq_intake_events'
  ) THEN
    RAISE EXCEPTION 'Safety check: shell_control.eq_intake_events not found — are you on the right project?';
  END IF;
END $$;

-- Drop in dependency order (row_audit may FK → events; templates standalone)
DROP TABLE IF EXISTS shell_control.eq_intake_row_audit  CASCADE;
DROP TABLE IF EXISTS shell_control.eq_intake_events     CASCADE;
DROP TABLE IF EXISTS shell_control.eq_intake_templates  CASCADE;
DROP TABLE IF EXISTS app_data.eq_intake_rate_limits     CASCADE;

COMMIT;
