-- Migration: 0071_quote_rate_presets
-- Target:    Per-tenant data plane (ehowgjardagevnrluult + future tenants)
-- Purpose:   Rate preset library for the native quote create form (Sprint 3).
--            Common line item templates stored per tenant — click to pre-fill.
--
--   quote_rate_presets        — table
--   eq_list_rate_presets()   — active presets for the JWT tenant, ordered
--
-- Idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE).

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.quote_rate_presets (
  preset_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  category        text,
  description     text        NOT NULL,
  unit            text,
  unit_rate_cents bigint      NOT NULL DEFAULT 0,
  qty_thousandths bigint      NOT NULL DEFAULT 1000,
  sort_order      integer     NOT NULL DEFAULT 0,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_rate_presets_tenant_idx
  ON app_data.quote_rate_presets (tenant_id, active, category, sort_order);

-- ============================================================================
-- 2. RPC — eq_list_rate_presets
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_rate_presets()
RETURNS TABLE (
  preset_id       uuid,
  category        text,
  description     text,
  unit            text,
  unit_rate_cents bigint,
  qty_thousandths bigint,
  sort_order      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  RETURN QUERY
  SELECT
    p.preset_id,
    p.category,
    p.description::text,
    p.unit::text,
    p.unit_rate_cents,
    p.qty_thousandths,
    p.sort_order
  FROM app_data.quote_rate_presets p
  WHERE p.tenant_id = v_tenant_id
    AND p.active = true
  ORDER BY p.category NULLS LAST, p.sort_order, p.description;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_rate_presets() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_rate_presets() TO authenticated;

-- ============================================================================
-- 3. Seed — SKS NSW default presets (idempotent: skip if any exist)
-- ============================================================================

DO $$
DECLARE
  v_tenant_id uuid := '7dee117c-98bd-4d39-af8c-2c81d02a1e85';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_data.quote_rate_presets WHERE tenant_id = v_tenant_id LIMIT 1
  ) THEN
    INSERT INTO app_data.quote_rate_presets
      (tenant_id, category, description, unit, unit_rate_cents, qty_thousandths, sort_order)
    VALUES
      -- Labour
      (v_tenant_id, 'Labour',    'Electrician — Day Rate',          'hr',   22000,  8000,  10),
      (v_tenant_id, 'Labour',    'Electrician — Night / OT Rate',   'hr',   33000,  8000,  20),
      (v_tenant_id, 'Labour',    'Supervisor — Day Rate',           'hr',   25000,  8000,  30),
      (v_tenant_id, 'Labour',    'Labourer / Offsider',             'hr',   16500,  8000,  40),
      -- Site costs
      (v_tenant_id, 'Site',      'Site Induction',                  'ea',   15000,  1000,  10),
      (v_tenant_id, 'Site',      'Traffic Control',                 'day',  85000,  1000,  20),
      (v_tenant_id, 'Site',      'EWP Hire',                        'day',  48000,  1000,  30),
      -- Materials
      (v_tenant_id, 'Materials', 'Materials — Allowance',           'lot',      0,  1000,  10),
      (v_tenant_id, 'Materials', 'Cabling — Allowance',             'lot',      0,  1000,  20);
  END IF;
END;
$$;
