-- ============================================================
-- Migration 0064: Contract scope — asset linkage for inline matching
--
-- Phase-2 from Royce's 26-Apr review: surface relevant scope items inline
-- on maintenance checks so site teams see "this asset is in/out of scope"
-- at the moment they're deciding what to inspect, not on the standalone
-- /contract-scope page nobody visits.
--
-- Decisions:
--   - asset_id     (nullable) — pin a scope row to a single asset.
--   - job_plan_id  (nullable) — pin a scope row to a job-plan family
--                                (e.g. all E1.25 ACBs at this site).
--   - Both nullable so existing rows ("Quarterly maintenance is in scope
--     for the whole site") still validate.
--   - Match precedence in app code:
--       1. asset_id == this asset                 → exact match
--       2. job_plan_id == this asset's job_plan   → family match
--       3. site_id == this asset's site           → site-wide
--       4. customer_id only                       → fallback
-- ============================================================

ALTER TABLE public.contract_scopes
  ADD COLUMN IF NOT EXISTS asset_id    uuid REFERENCES public.assets(id)     ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS job_plan_id uuid REFERENCES public.job_plans(id)  ON DELETE SET NULL;

COMMENT ON COLUMN public.contract_scopes.asset_id IS
  'Optional pin to a single asset. NULL = scope applies at site or higher.';
COMMENT ON COLUMN public.contract_scopes.job_plan_id IS
  'Optional pin to a job-plan family (e.g. all E1.25 ACBs). NULL = scope is not job-plan-specific.';

-- Filtered partial indexes — most rows are at customer/site level, so
-- only index the rows that carry a pin.
CREATE INDEX IF NOT EXISTS idx_contract_scopes_asset_id
  ON public.contract_scopes(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_scopes_job_plan_id
  ON public.contract_scopes(job_plan_id) WHERE job_plan_id IS NOT NULL;
