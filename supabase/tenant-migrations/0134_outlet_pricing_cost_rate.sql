-- Migration 0134: Add cost_rate_cents to outlet pricing RPCs
-- eq_price_outlet_install: per-line cost (raw material spend + labour cost before volume discount)
-- eq_price_outlet_removal: lump-sum cost (total before removal_markup)

CREATE OR REPLACE FUNCTION public.eq_price_outlet_install(
  p_product_id uuid,
  p_pairs      integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_data
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
  v_raw_mat      numeric;
  v_raw_lab      numeric;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT * INTO v_cfg FROM app_data.pricing_config WHERE tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pricing config not found for tenant';
  END IF;

  SELECT * INTO v_prod FROM app_data.pricing_products
  WHERE product_id = p_product_id AND tenant_id = v_tenant_id AND archived = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;

  SELECT unit_cost INTO v_cable   FROM app_data.pricing_materials WHERE material_id = v_prod.cable_material_id;
  SELECT unit_cost INTO v_outlet  FROM app_data.pricing_materials WHERE material_id = v_prod.outlet_material_id;
  SELECT unit_cost INTO v_breaker FROM app_data.pricing_materials WHERE material_id = v_prod.breaker_material_id;

  -- Raw material cost per pair (before markup) — this is the buy cost
  v_raw_mat := ROUND(
    v_prod.cable_qty   * COALESCE(v_cable.unit_cost, 0) +
    v_prod.outlet_qty  * COALESCE(v_outlet.unit_cost, 0) +
    v_prod.breaker_qty * COALESCE(v_breaker.unit_cost, 0),
    2
  );

  -- Material sell cost per pair (buy × markup)
  v_mat_cost := v_raw_mat * v_cfg.material_markup;

  -- Labour cost for the job (install + mgmt hours × rates)
  v_labour_cost :=
    v_prod.install_hours * v_cfg.labour_normal_rate +
    v_prod.mgmt_hours    * v_cfg.labour_supervisor_rate;

  -- Labour buy cost per pair
  v_raw_lab := ROUND(v_labour_cost / GREATEST(p_pairs, 1), 2);

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
        'cost_rate_cents',  (v_raw_mat * 100)::bigint,
        'line_total_cents', (ROUND(v_mat_rate * p_pairs, 2) * 100)::bigint
      ),
      jsonb_build_object(
        'section',          'labour',
        'description',      'Labour — install & management',
        'unit',             'pair',
        'qty_thousandths',  (p_pairs * 1000)::bigint,
        'unit_rate_cents',  (v_lab_rate * 100)::bigint,
        'cost_rate_cents',  (v_raw_lab * 100)::bigint,
        'line_total_cents', (ROUND(v_lab_rate * p_pairs, 2) * 100)::bigint
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.eq_price_outlet_removal(p_pairs integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_data
AS $$
DECLARE
  v_tenant_id uuid;
  v_cfg       record;
  v_raw_cost  numeric;
  v_total     numeric;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT * INTO v_cfg FROM app_data.pricing_config WHERE tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pricing config not found for tenant';
  END IF;

  -- Raw cost before markup
  v_raw_cost := ROUND(v_cfg.removal_base + GREATEST(p_pairs - 1, 0) * v_cfg.removal_increment, 2);
  v_total    := ROUND(v_raw_cost * v_cfg.removal_markup, 2);

  RETURN jsonb_build_object(
    'ok',          true,
    'pairs',       p_pairs,
    'total_cents', (v_total * 100)::bigint,
    'line', jsonb_build_object(
      'section',          'labour',
      'description',      'Outlet removal — ' || p_pairs || ' pair' || CASE WHEN p_pairs > 1 THEN 's' ELSE '' END,
      'unit',             'ls',
      'qty_thousandths',  1000::bigint,
      'unit_rate_cents',  (v_total * 100)::bigint,
      'cost_rate_cents',  (v_raw_cost * 100)::bigint,
      'line_total_cents', (v_total * 100)::bigint
    )
  );
END;
$$;
