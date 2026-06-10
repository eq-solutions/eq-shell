-- Migration 0066: Customer-scoped job plans + Jemena asset identifiers.
--
-- Scope:
-- 1. job_plans.customer_id — lets a plan apply to all sites of a customer
--    (customer_id set, site_id null), or one site (legacy, site_id set,
--    customer_id null), or be tenant-global (both null).
-- 2. assets.jemena_asset_id — Jemena's primary asset key (JM######).
--    Distinct from maximo_id (Equinix/Maximo).
-- 3. assets.expected_rcd_circuits — for distribution boards, number of RCD
--    circuits expected. Used as a QC check during RCD test data import
--    ("imported 14 of expected 15 circuits").
--
-- All additive + nullable. RLS unchanged (tenant_id scope already covers it).

-- ============================================================
-- 1. job_plans.customer_id
-- ============================================================

ALTER TABLE public.job_plans
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_plans_customer_idx
  ON public.job_plans(customer_id)
  WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.job_plans.customer_id IS
  'When set with site_id null, plan applies to all sites of this customer. When null, plan is site-scoped (legacy) or tenant-global.';

-- ============================================================
-- 2. assets.jemena_asset_id
-- ============================================================

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS jemena_asset_id text;

CREATE INDEX IF NOT EXISTS assets_jemena_asset_id_idx
  ON public.assets(tenant_id, jemena_asset_id)
  WHERE jemena_asset_id IS NOT NULL;

COMMENT ON COLUMN public.assets.jemena_asset_id IS
  'Jemena primary asset key (JM######). Distinct from maximo_id which is reserved for Equinix/Maximo.';

-- ============================================================
-- 3. assets.expected_rcd_circuits
-- ============================================================

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS expected_rcd_circuits int
    CHECK (expected_rcd_circuits IS NULL OR expected_rcd_circuits >= 0);

COMMENT ON COLUMN public.assets.expected_rcd_circuits IS
  'For distribution boards: number of RCD circuits expected on this board. Used for QC during RCD test data import.';
