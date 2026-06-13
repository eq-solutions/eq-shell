-- Migration: 0077_quote_totals_recompute
-- Target:    Per-tenant data plane
-- Purpose:   Trust & correctness — one source of truth for quote rollups.
--
--   Problem: eq_add_line_item (the create path) inserted a line but never
--            recomputed quote.subtotal/gst/total/margin_pct. A natively-created
--            quote therefore showed $0 totals and NULL margin until first edit
--            (which calls eq_replace_line_items, the only path that rolled up).
--
--   Fix:     Extract the rollup — including margin — into one internal helper,
--            eq__recompute_quote_totals(quote_id), and call it from BOTH
--            eq_add_line_item and eq_replace_line_items. The margin formula now
--            lives in exactly one place, and no write path can leave stale totals.
--
--   Behaviour-preserving for eq_replace_line_items (same numbers, computed once
--   at the end instead of inline). Net-new correct behaviour for eq_add_line_item.
--
-- All idempotent (CREATE OR REPLACE; signatures unchanged).

-- ============================================================================
-- 1. eq__recompute_quote_totals — internal rollup helper (NOT exposed to PostgREST)
-- ============================================================================
--
--   subtotal = Σ line_total_cents
--   gst      = subtotal / 10            (10% GST, integer division — matches prior)
--   total    = subtotal + gst
--   margin   = (sell - cost) / sell × 100, 2dp, NULL when sell <= 0
--     where cost = Σ (qty_thousandths × cost_rate_cents) / 1000  (per-row, matches prior)
--
-- Tenant ownership is validated by the caller before this runs; this helper is
-- internal only (no GRANT to authenticated), so it is never reachable directly.

CREATE OR REPLACE FUNCTION public.eq__recompute_quote_totals(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_sell bigint;
  v_cost bigint;
  v_gst  bigint;
BEGIN
  SELECT
    COALESCE(sum(line_total_cents), 0),
    COALESCE(sum((quantity_thousandths * cost_rate_cents) / 1000), 0)
  INTO v_sell, v_cost
  FROM app_data.quote_line_item
  WHERE quote_id = p_quote_id;

  v_gst := v_sell / 10;

  UPDATE app_data.quote
  SET subtotal_cents = v_sell,
      gst_cents      = v_gst,
      total_cents    = v_sell + v_gst,
      margin_pct     = CASE WHEN v_sell > 0
                         THEN round(((v_sell - v_cost)::numeric / v_sell) * 100, 2)
                         ELSE NULL END,
      updated_at     = now()
  WHERE quote_id = p_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq__recompute_quote_totals(uuid) FROM PUBLIC;
-- intentionally NOT granted to authenticated: internal helper only.

-- ============================================================================
-- 2. eq_add_line_item — insert a line, then recompute totals (was: no rollup)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_add_line_item(
  p_quote_id           uuid,
  p_line_number        integer,
  p_description        text,
  p_qty_thousandths    bigint,
  p_unit_rate_cents    bigint,
  p_unit               text    DEFAULT NULL,
  p_category           text    DEFAULT NULL,
  p_cost_rate_cents    bigint  DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_line_total  bigint;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.quote
    WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  v_line_total := (p_qty_thousandths * p_unit_rate_cents) / 1000;

  INSERT INTO app_data.quote_line_item (
    tenant_id, quote_id, line_number,
    description, quantity_thousandths, unit_rate_cents, line_total_cents,
    unit, category, cost_rate_cents
  ) VALUES (
    v_tenant_id, p_quote_id, p_line_number,
    p_description, p_qty_thousandths, p_unit_rate_cents, v_line_total,
    NULLIF(trim(p_unit), ''), NULLIF(trim(p_category), ''),
    COALESCE(p_cost_rate_cents, 0)
  );

  PERFORM public.eq__recompute_quote_totals(p_quote_id);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_add_line_item(uuid, integer, text, bigint, bigint, text, text, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_add_line_item(uuid, integer, text, bigint, bigint, text, text, bigint) TO authenticated;

-- ============================================================================
-- 3. eq_replace_line_items — swap lines, then recompute via the shared helper
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_replace_line_items(
  p_quote_id   uuid,
  p_line_items jsonb
  -- [{line_number, description, qty_thousandths, unit_rate_cents, unit, category, cost_rate_cents?}, ...]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id    uuid;
  v_item         jsonb;
  v_line_total   bigint;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.quote
    WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  DELETE FROM app_data.quote_line_item
  WHERE quote_id = p_quote_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items) LOOP
    v_line_total := (
      (v_item->>'qty_thousandths')::bigint *
      (v_item->>'unit_rate_cents')::bigint
    ) / 1000;

    INSERT INTO app_data.quote_line_item (
      tenant_id, quote_id, line_number,
      description, quantity_thousandths, unit_rate_cents, line_total_cents,
      unit, category, cost_rate_cents
    ) VALUES (
      v_tenant_id,
      p_quote_id,
      (v_item->>'line_number')::integer,
      v_item->>'description',
      (v_item->>'qty_thousandths')::bigint,
      (v_item->>'unit_rate_cents')::bigint,
      v_line_total,
      NULLIF(trim(v_item->>'unit'), ''),
      NULLIF(trim(v_item->>'category'), ''),
      COALESCE((v_item->>'cost_rate_cents')::bigint, 0)
    );
  END LOOP;

  PERFORM public.eq__recompute_quote_totals(p_quote_id);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_replace_line_items(uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_replace_line_items(uuid, jsonb) TO authenticated;
