-- Migration: 0050_check_assets_wo_unique_idx
-- Purpose: Prevent duplicate work-order numbers within a tenant on check_assets.
--          Backs the duplicate-detection step of the Delta WO import flow — if
--          someone re-uploads the August file, the unique index is a hard backstop
--          in case the app-layer check is bypassed.
-- Applied: 2026-04-19 via Supabase MCP
-- Rollback:
--   DROP INDEX IF EXISTS public.check_assets_tenant_wo_unique_idx;
--
-- Pre-flight check run 2026-04-19 against urjhmkhbgaxrofurpbgc: zero existing
-- duplicate (tenant_id, work_order_number) pairs — safe to create as unique.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS check_assets_tenant_wo_unique_idx
  ON public.check_assets (tenant_id, work_order_number)
  WHERE work_order_number IS NOT NULL AND work_order_number <> '';

COMMENT ON INDEX public.check_assets_tenant_wo_unique_idx IS
  'Enforces one check_asset per (tenant, work_order_number). WO numbers come from upstream Maximo and are globally unique there, so duplicates at our layer indicate either a re-upload of the same import file or a data-entry collision — both should be caught before insert.';

COMMIT;
