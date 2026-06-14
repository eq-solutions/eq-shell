-- Migration: 0076_outlet_pricing
-- Target:    Per-tenant data plane
-- Purpose:   Equinix outlet install/removal pricing calculator
--            Ports the pricing engine from eq-quotes-port (migration 033).
--
--   Tables:  pricing_config, pricing_materials, pricing_products, pricing_bands
--   RPCs:    eq_list_pricing_products, eq_price_outlet_install, eq_price_outlet_removal

-- ============================================================================
-- 1. pricing_config — one row per tenant (singleton)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.pricing_config (
  config_id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL UNIQUE,
  material_markup        numeric(6,4) NOT NULL DEFAULT 1.15,
  labour_normal_rate     numeric(10,2) NOT NULL DEFAULT 115.00,
  labour_supervisor_rate numeric(10,2) NOT NULL DEFAULT 135.00,
  removal_base           numeric(10,2) NOT NULL DEFAULT 455.00,
  removal_increment      numeric(10,2) NOT NULL DEFAULT 170.00,
  removal_markup         numeric(6,4) NOT NULL DEFAULT 1.25,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE app_data.pricing_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pricing_config' AND policyname = 'tenant_iso') THEN
    CREATE POLICY tenant_iso ON app_data.pricing_config
      USING (tenant_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;

-- ============================================================================
-- 2. pricing_materials — component catalogue
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.pricing_materials (
  material_id  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  part_no      text        NOT NULL,
  description  text        NOT NULL,
  unit         text,
  unit_cost    numeric(10,4) NOT NULL DEFAULT 0,
  archived     boolean     NOT NULL DEFAULT false,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, part_no)
);

ALTER TABLE app_data.pricing_materials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pricing_materials' AND policyname = 'tenant_iso') THEN
    CREATE POLICY tenant_iso ON app_data.pricing_materials
      USING (tenant_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;

-- ============================================================================
-- 3. pricing_products — outlet product types + BOM recipe
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.pricing_products (
  product_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  category           text        NOT NULL DEFAULT 'outlets',
  name               text        NOT NULL,
  brand              text,
  phase              text,
  plug_type          text,
  cable_material_id  uuid        REFERENCES app_data.pricing_materials(material_id),
  cable_qty          numeric(10,2) NOT NULL DEFAULT 0,
  outlet_material_id uuid        REFERENCES app_data.pricing_materials(material_id),
  outlet_qty         numeric(10,2) NOT NULL DEFAULT 0,
  breaker_material_id uuid       REFERENCES app_data.pricing_materials(material_id),
  breaker_qty        numeric(10,2) NOT NULL DEFAULT 0,
  install_hours      numeric(10,2) NOT NULL DEFAULT 0,
  mgmt_hours         numeric(10,2) NOT NULL DEFAULT 0,
  archived           boolean     NOT NULL DEFAULT false,
  sort_order         integer     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_data.pricing_products ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pricing_products' AND policyname = 'tenant_iso') THEN
    CREATE POLICY tenant_iso ON app_data.pricing_products
      USING (tenant_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;

-- ============================================================================
-- 4. pricing_bands — volume discount schedule
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.pricing_bands (
  band_id    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid    NOT NULL,
  category   text    NOT NULL DEFAULT 'outlets',
  min_qty    integer NOT NULL,
  max_qty    integer,
  factor     numeric(6,4) NOT NULL DEFAULT 1.0,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, category, min_qty)
);

ALTER TABLE app_data.pricing_bands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pricing_bands' AND policyname = 'tenant_iso') THEN
    CREATE POLICY tenant_iso ON app_data.pricing_bands
      USING (tenant_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;

-- ============================================================================
-- 5. Seed SKS defaults (idempotent — skip if config already exists)
-- ============================================================================

DO $$
DECLARE
  v_tenant   uuid := '7dee117c-98bd-4d39-af8c-2c81d02a1e85';
  v_cable    uuid;
  v_outlet_s uuid;
  v_outlet_t uuid;
  v_breaker  uuid;
  v_outlet_i uuid;
BEGIN
  -- Skip if already seeded
  IF EXISTS (SELECT 1 FROM app_data.pricing_config WHERE tenant_id = v_tenant) THEN
    RETURN;
  END IF;

  -- Config
  INSERT INTO app_data.pricing_config
    (tenant_id, material_markup, labour_normal_rate, labour_supervisor_rate,
     removal_base, removal_increment, removal_markup)
  VALUES
    (v_tenant, 1.15, 115.00, 135.00, 455.00, 170.00, 1.25);

  -- Materials
  INSERT INTO app_data.pricing_materials (tenant_id, part_no, description, unit, unit_cost, sort_order)
  VALUES
    (v_tenant, 'CBL-6MM-2CE',  'Cable 2C+E 6mm grey (400/750V)',   'm',  4.50, 10),
    (v_tenant, 'CBL-6MM-3CE',  'Cable 3C+E 6mm grey (400/750V)',   'm',  5.20, 20),
    (v_tenant, 'OUT-1P-32A-C', 'Outlet single phase 32A Clipsal',  'ea', 22.00, 30),
    (v_tenant, 'OUT-1P-32A-I', 'Outlet single phase 32A IPD',      'ea', 19.50, 40),
    (v_tenant, 'OUT-3P-32A-C', 'Outlet three phase 32A Clipsal',   'ea', 38.00, 50),
    (v_tenant, 'OUT-3P-32A-I', 'Outlet three phase 32A IPD',       'ea', 34.50, 60),
    (v_tenant, 'BRK-1P-32A',   'Breaker single phase 32A',         'ea', 28.00, 70),
    (v_tenant, 'BRK-3P-32A',   'Breaker three phase 32A',          'ea', 42.00, 80);

  -- Re-select material IDs by part_no
  SELECT material_id INTO v_cable    FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'CBL-6MM-2CE';
  SELECT material_id INTO v_outlet_s FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'OUT-1P-32A-C';
  SELECT material_id INTO v_outlet_t FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'OUT-3P-32A-C';
  SELECT material_id INTO v_breaker  FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'BRK-1P-32A';
  SELECT material_id INTO v_outlet_i FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'OUT-1P-32A-I';

  -- Products
  INSERT INTO app_data.pricing_products
    (tenant_id, category, name, brand, phase, plug_type,
     cable_material_id, cable_qty,
     outlet_material_id, outlet_qty,
     breaker_material_id, breaker_qty,
     install_hours, mgmt_hours, sort_order)
  VALUES
    (v_tenant, 'outlets', 'Single phase 32A 3 pin outlet (Clipsal)', 'Clipsal', 'single', 'Standard',
     v_cable, 50, v_outlet_s, 2, v_breaker, 2, 10, 2, 10),
    (v_tenant, 'outlets', 'Single phase 32A 3 pin outlet (IPD)', 'IPD', 'single', 'Standard',
     v_cable, 50,
     (SELECT material_id FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'OUT-1P-32A-I'),
     2, v_breaker, 2, 10, 2, 20),
    (v_tenant, 'outlets', 'Single phase 32A IEC 60309 outlet (Clipsal)', 'Clipsal', 'single', 'IEC 60309',
     v_cable, 50, v_outlet_s, 2, v_breaker, 2, 10, 2, 30),
    (v_tenant, 'outlets', 'Single phase 32A IEC 60309 outlet (IPD)', 'IPD', 'single', 'IEC 60309',
     v_cable, 50, v_outlet_i, 2, v_breaker, 2, 10, 2, 40),
    (v_tenant, 'outlets', 'Three phase 32A IEC 60309 outlet (Clipsal)', 'Clipsal', 'three', 'IEC 60309',
     (SELECT material_id FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'CBL-6MM-3CE'),
     50, v_outlet_t, 2,
     (SELECT material_id FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'BRK-3P-32A'),
     2, 12, 2, 50),
    (v_tenant, 'outlets', 'Three phase 32A IEC 60309 outlet (IPD)', 'IPD', 'three', 'IEC 60309',
     (SELECT material_id FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'CBL-6MM-3CE'),
     50,
     (SELECT material_id FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'OUT-3P-32A-I'),
     2,
     (SELECT material_id FROM app_data.pricing_materials WHERE tenant_id = v_tenant AND part_no = 'BRK-3P-32A'),
     2, 12, 2, 60);

  -- Volume discount bands (outlets category)
  INSERT INTO app_data.pricing_bands (tenant_id, category, min_qty, max_qty, factor, sort_order)
  VALUES
    (v_tenant, 'outlets',  1, 10, 1.0000, 10),
    (v_tenant, 'outlets', 11, 20, 0.9500, 20),
    (v_tenant, 'outlets', 21, 30, 0.9000, 30),
    (v_tenant, 'outlets', 31, 40, 0.8500, 40),
    (v_tenant, 'outlets', 41, NULL, 0.8000, 50);
END $$;

-- ============================================================================
-- 6. eq_list_pricing_products — picker data for the calculator UI
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_pricing_products(
  p_category text DEFAULT 'outlets'
)
RETURNS TABLE (
  product_id uuid,
  name       text,
  brand      text,
  phase      text,
  plug_type  text
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
  SELECT p.product_id, p.name::text, p.brand::text, p.phase::text, p.plug_type::text
  FROM app_data.pricing_products p
  WHERE p.tenant_id = v_tenant_id
    AND p.category  = p_category
    AND p.archived  = false
  ORDER BY p.sort_order, p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_pricing_products(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_pricing_products(text) TO authenticated;

-- ============================================================================
-- 7. eq_price_outlet_install — parametric install pricing
--
--   Formula per pair (before band discount):
--     material_cost = Σ(component.qty × mat.unit_cost) × config.material_markup
--     labour_cost   = product.install_hours × config.labour_normal_rate
--                   + product.mgmt_hours    × config.labour_supervisor_rate
--     base_per_pair = material_cost + labour_cost
--
--   With discount:
--     factor          = band.factor for p_pairs in [band.min_qty, band.max_qty]
--     price_per_pair  = ROUND(base_per_pair × factor, 2)
--     total           = price_per_pair × p_pairs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_price_outlet_install(
  p_product_id uuid,
  p_pairs      integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id    uuid;
  v_cfg          record;
  v_prod         record;
  v_cable        record;
  v_outlet       record;
  v_breaker      record;
  v_mat_cost     numeric;
  v_labour_cost  numeric;
  v_base         numeric;
  v_factor       numeric;
  v_rate         numeric;
  v_total        numeric;
  v_mat_rate     numeric;
  v_lab_rate     numeric;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  -- Config
  SELECT * INTO v_cfg FROM app_data.pricing_config WHERE tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pricing config not found for tenant';
  END IF;

  -- Product
  SELECT * INTO v_prod FROM app_data.pricing_products
  WHERE product_id = p_product_id AND tenant_id = v_tenant_id AND archived = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;

  -- Materials
  SELECT unit_cost INTO v_cable   FROM app_data.pricing_materials WHERE material_id = v_prod.cable_material_id;
  SELECT unit_cost INTO v_outlet  FROM app_data.pricing_materials WHERE material_id = v_prod.outlet_material_id;
  SELECT unit_cost INTO v_breaker FROM app_data.pricing_materials WHERE material_id = v_prod.breaker_material_id;

  v_mat_cost := (
    v_prod.cable_qty   * COALESCE(v_cable.unit_cost, 0) +
    v_prod.outlet_qty  * COALESCE(v_outlet.unit_cost, 0) +
    v_prod.breaker_qty * COALESCE(v_breaker.unit_cost, 0)
  ) * v_cfg.material_markup;

  v_labour_cost :=
    v_prod.install_hours * v_cfg.labour_normal_rate +
    v_prod.mgmt_hours    * v_cfg.labour_supervisor_rate;

  v_base := v_mat_cost + v_labour_cost;

  -- Volume discount band
  SELECT COALESCE(factor, 1.0) INTO v_factor
  FROM app_data.pricing_bands
  WHERE tenant_id = v_tenant_id
    AND category  = 'outlets'
    AND min_qty   <= p_pairs
    AND (max_qty IS NULL OR max_qty >= p_pairs)
  ORDER BY min_qty DESC
  LIMIT 1;

  IF v_factor IS NULL THEN v_factor := 1.0; END IF;

  v_rate  := ROUND(v_base * v_factor, 2);
  v_total := ROUND(v_rate * p_pairs, 2);

  -- Split into materials vs labour rates (proportional)
  IF v_base > 0 THEN
    v_mat_rate := ROUND(v_mat_cost / v_base * v_rate, 2);
    v_lab_rate := v_rate - v_mat_rate;
  ELSE
    v_mat_rate := 0;
    v_lab_rate := 0;
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'product_name',    v_prod.name,
    'pairs',           p_pairs,
    'discount_factor', v_factor,
    'total_cents',     (v_total * 100)::bigint,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'section',          'materials',
        'description',      'Materials — ' || v_prod.name,
        'unit',             'pair',
        'qty_thousandths',  (p_pairs * 1000)::bigint,
        'unit_rate_cents',  (v_mat_rate * 100)::bigint,
        'line_total_cents', (ROUND(v_mat_rate * p_pairs, 2) * 100)::bigint
      ),
      jsonb_build_object(
        'section',          'labour',
        'description',      'Labour — install & management',
        'unit',             'pair',
        'qty_thousandths',  (p_pairs * 1000)::bigint,
        'unit_rate_cents',  (v_lab_rate * 100)::bigint,
        'line_total_cents', (ROUND(v_lab_rate * p_pairs, 2) * 100)::bigint
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_price_outlet_install(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_price_outlet_install(uuid, integer) TO authenticated;

-- ============================================================================
-- 8. eq_price_outlet_removal
--
--   Formula:
--     total = (removal_base + (p_pairs - 1) × removal_increment) × removal_markup
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_price_outlet_removal(
  p_pairs integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_cfg       record;
  v_total     numeric;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT * INTO v_cfg FROM app_data.pricing_config WHERE tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pricing config not found for tenant';
  END IF;

  v_total := ROUND(
    (v_cfg.removal_base + GREATEST(p_pairs - 1, 0) * v_cfg.removal_increment) * v_cfg.removal_markup,
    2
  );

  RETURN jsonb_build_object(
    'ok',         true,
    'pairs',      p_pairs,
    'total_cents', (v_total * 100)::bigint,
    'line', jsonb_build_object(
      'section',          'labour',
      'description',      'Outlet removal — ' || p_pairs || ' pair' || CASE WHEN p_pairs > 1 THEN 's' ELSE '' END,
      'unit',             'ls',
      'qty_thousandths',  1000::bigint,
      'unit_rate_cents',  (v_total * 100)::bigint,
      'line_total_cents', (v_total * 100)::bigint
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_price_outlet_removal(integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_price_outlet_removal(integer) TO authenticated;
