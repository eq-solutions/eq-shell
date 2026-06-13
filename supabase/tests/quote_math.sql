-- Money-math regression tests for EQ Ops quotes.
--
-- Exercises the real RPC chain (create → set line items → add line → status) and
-- the outlet pricing engine against whichever tenant has pricing seeded, then
-- ROLLBACKs so nothing persists. Any mismatch raises and aborts.
--
--   psql "$DATABASE_URL" -f supabase/tests/quote_math.sql
--   (or paste into the Supabase SQL editor)
--
-- On success the final line is NOTICE: QUOTE_MATH_TESTS_PASSED, then ROLLBACK.
-- Pairs with the TS unit tests in src/modules/quotes/quoteMath.test.ts — both
-- assert the same numbers so the client preview and the DB rollup stay in lock-step.

BEGIN;

-- Scope this transaction to a tenant that has pricing seeded.
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'app_metadata', json_build_object('tenant_id', (SELECT tenant_id FROM app_data.pricing_config LIMIT 1)),
    'sub', '00000000-0000-0000-0000-000000000001'
  )::text,
  true
);

DO $$
DECLARE
  v_tenant  uuid;
  v_cust    uuid;
  v_qid     uuid;
  v_qid2    uuid;
  v_sub     bigint; v_gst bigint; v_tot bigint; v_margin numeric;
  v_sub2    bigint; v_margin2 numeric;
  v_notes   int;
  -- outlet pricing
  v_pairs   int := 15;
  v_prod    uuid;
  v_cfg     record;
  v_p       record;
  v_cable   numeric; v_outlet numeric; v_breaker numeric;
  v_mat     numeric; v_lab numeric; v_base numeric;
  v_factor  numeric; v_rate numeric; v_total numeric;
  r_inst    jsonb; r_rem jsonb;
BEGIN
  v_tenant := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant has pricing_config seeded — cannot run quote-math tests.';
  END IF;

  -- ── Quote rollup + margin (create path) ──────────────────────────────────
  SELECT customer_id INTO v_cust FROM app_data.customers WHERE tenant_id = v_tenant LIMIT 1;
  IF v_cust IS NULL THEN
    RAISE EXCEPTION 'No customer in tenant % to attach a test quote to.', v_tenant;
  END IF;

  SELECT quote_id INTO v_qid
  FROM public.eq_create_quote(v_cust, NULL, 'TEST quote-math', NULL, NULL, NULL, NULL, 30,
       NULL, NULL, NULL, NULL, NULL, NULL);

  PERFORM public.eq_replace_line_items(v_qid, '[
    {"line_number":1,"description":"L1","qty_thousandths":2000,"unit_rate_cents":11500,"cost_rate_cents":10000,"unit":"ea","category":"material"},
    {"line_number":2,"description":"L2","qty_thousandths":1000,"unit_rate_cents":50000,"cost_rate_cents":40000,"unit":"ea","category":"labour"}
  ]'::jsonb);

  SELECT subtotal_cents, gst_cents, total_cents, margin_pct
    INTO v_sub, v_gst, v_tot, v_margin
  FROM app_data.quote WHERE quote_id = v_qid;

  ASSERT v_sub    = 73000, format('subtotal %s <> 73000', v_sub);
  ASSERT v_gst    = 7300,  format('gst %s <> 7300', v_gst);
  ASSERT v_tot    = 80300, format('total %s <> 80300', v_tot);
  ASSERT v_margin = 17.81, format('margin %s <> 17.81', v_margin);

  -- ── add_line_item must roll up too (regression: the old $0-on-create bug) ──
  SELECT quote_id INTO v_qid2
  FROM public.eq_create_quote(v_cust, NULL, 'TEST add', NULL, NULL, NULL, NULL, 30,
       NULL, NULL, NULL, NULL, NULL, NULL);
  PERFORM public.eq_add_line_item(v_qid2, 1, 'AL', 1000, 20000, 'ea', 'material', 15000);
  SELECT subtotal_cents, margin_pct INTO v_sub2, v_margin2 FROM app_data.quote WHERE quote_id = v_qid2;
  ASSERT v_sub2    = 20000, format('add subtotal %s <> 20000', v_sub2);
  ASSERT v_margin2 = 25.00, format('add margin %s <> 25.00', v_margin2);

  -- ── Status transition writes an audit note ───────────────────────────────
  PERFORM public.eq_update_quote_status(v_qid, 'submitted', 'test', 'TT');
  SELECT count(*) INTO v_notes FROM app_data.job_notes WHERE quote_id = v_qid;
  ASSERT v_notes >= 1, 'status change wrote no audit note';

  -- ── Outlet install: RPC total must equal an independent recompute ─────────
  SELECT product_id INTO v_prod
  FROM app_data.pricing_products
  WHERE tenant_id = v_tenant AND archived = false
  ORDER BY sort_order LIMIT 1;

  IF v_prod IS NOT NULL THEN
    SELECT * INTO v_cfg FROM app_data.pricing_config WHERE tenant_id = v_tenant;
    SELECT * INTO v_p   FROM app_data.pricing_products WHERE product_id = v_prod;
    SELECT unit_cost INTO v_cable   FROM app_data.pricing_materials WHERE material_id = v_p.cable_material_id;
    SELECT unit_cost INTO v_outlet  FROM app_data.pricing_materials WHERE material_id = v_p.outlet_material_id;
    SELECT unit_cost INTO v_breaker FROM app_data.pricing_materials WHERE material_id = v_p.breaker_material_id;

    v_mat := (v_p.cable_qty   * COALESCE(v_cable, 0)
            + v_p.outlet_qty  * COALESCE(v_outlet, 0)
            + v_p.breaker_qty * COALESCE(v_breaker, 0)) * v_cfg.material_markup;
    v_lab := v_p.install_hours * v_cfg.labour_normal_rate
           + v_p.mgmt_hours    * v_cfg.labour_supervisor_rate;
    v_base := v_mat + v_lab;

    SELECT COALESCE(factor, 1.0) INTO v_factor
    FROM app_data.pricing_bands
    WHERE tenant_id = v_tenant AND category = 'outlets'
      AND min_qty <= v_pairs AND (max_qty IS NULL OR max_qty >= v_pairs)
    ORDER BY min_qty DESC LIMIT 1;
    IF v_factor IS NULL THEN v_factor := 1.0; END IF;

    v_rate  := ROUND(v_base * v_factor, 2);
    v_total := ROUND(v_rate * v_pairs, 2);

    r_inst := public.eq_price_outlet_install(v_prod, v_pairs);
    ASSERT (r_inst->>'total_cents')::bigint = (v_total * 100)::bigint,
      format('install total_cents %s <> recompute %s', r_inst->>'total_cents', (v_total * 100)::bigint);
  END IF;

  -- ── Outlet removal: RPC total must equal an independent recompute ─────────
  SELECT * INTO v_cfg FROM app_data.pricing_config WHERE tenant_id = v_tenant;
  v_total := ROUND(
    (v_cfg.removal_base + GREATEST(v_pairs - 1, 0) * v_cfg.removal_increment) * v_cfg.removal_markup, 2);
  r_rem := public.eq_price_outlet_removal(v_pairs);
  ASSERT (r_rem->>'total_cents')::bigint = (v_total * 100)::bigint,
    format('removal total_cents %s <> recompute %s', r_rem->>'total_cents', (v_total * 100)::bigint);

  RAISE NOTICE 'QUOTE_MATH_TESTS_PASSED';
END $$;

ROLLBACK;
