-- Migration: 0070_eq_create_quote_rpcs
-- Target:    Per-tenant data plane (ehowgjardagevnrluult + future tenants)
-- Purpose:   Native quote creation from EQ Shell (Sprint 2).
--            Replaces EQ Quotes Flask app for new quote creation.
--
--   eq_list_customers()      — active customer list for client picker
--   eq_create_quote(...)     — create draft quote with EQ-YYMMDD-NNNN number
--   eq_add_line_item(...)    — append line item + recalculate quote totals
--
-- Idempotent (CREATE OR REPLACE).

-- ============================================================================
-- 1. eq_list_customers — client picker
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_customers()
RETURNS TABLE (
  customer_id   uuid,
  company_name  text,
  external_id   text
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
    c.customer_id,
    c.company_name::text,
    c.external_id::text
  FROM app_data.customers c
  WHERE c.tenant_id = v_tenant_id
    AND (c.active IS NULL OR c.active = true)
  ORDER BY c.company_name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_customers() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_customers() TO authenticated;

-- ============================================================================
-- 2. eq_create_quote — create draft quote, assign EQ-YYMMDD-NNNN number
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_create_quote(
  p_customer_id          uuid,
  p_project_name         text    DEFAULT NULL,
  p_estimator_name       text    DEFAULT NULL,
  p_estimator_initials   text    DEFAULT NULL,
  p_scope_of_works       text    DEFAULT NULL,
  p_notes                text    DEFAULT NULL,
  p_validity_days        integer DEFAULT 30
)
RETURNS TABLE (
  quote_id     uuid,
  quote_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_quote_id   uuid;
  v_seq        bigint;
  v_quote_num  text;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.customers
    WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'customer not found or access denied';
  END IF;

  -- Sequential EQ-native quote number: EQ-YYMMDD-NNNN
  SELECT count(*) + 1 INTO v_seq
  FROM app_data.quote
  WHERE tenant_id = v_tenant_id
    AND quote_number LIKE 'EQ-%';

  v_quote_num := 'EQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO app_data.quote (
    tenant_id, customer_id, quote_number,
    project_name, estimator_name, estimator_initials,
    scope_of_works, notes,
    validity_days, expires_at,
    status, subtotal_cents, gst_cents, total_cents,
    imported_from,
    created_by
  ) VALUES (
    v_tenant_id, p_customer_id, v_quote_num,
    p_project_name, p_estimator_name, p_estimator_initials,
    p_scope_of_works, p_notes,
    p_validity_days, now() + (p_validity_days || ' days')::interval,
    'draft', 0, 0, 0,
    'eq-shell',
    (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
  )
  RETURNING quote_id INTO v_quote_id;

  RETURN QUERY SELECT v_quote_id, v_quote_num;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_create_quote(uuid, text, text, text, text, text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_create_quote(uuid, text, text, text, text, text, integer) TO authenticated;

-- ============================================================================
-- 3. eq_add_line_item — append line item and recalculate quote totals
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_add_line_item(
  p_quote_id          uuid,
  p_line_number       integer,
  p_description       text,
  p_qty_thousandths   bigint  DEFAULT 1000,
  p_unit_rate_cents   bigint  DEFAULT 0,
  p_unit              text    DEFAULT NULL,
  p_category          text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id        uuid;
  v_line_item_id     uuid;
  v_line_total_cents bigint;
  v_subtotal         bigint;
  v_gst              bigint;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.quote
    WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  v_line_total_cents := (p_qty_thousandths * p_unit_rate_cents) / 1000;

  INSERT INTO app_data.quote_line_item (
    tenant_id, quote_id, line_number,
    description, quantity_thousandths, unit_rate_cents, line_total_cents,
    unit, category
  ) VALUES (
    v_tenant_id, p_quote_id, p_line_number,
    p_description, p_qty_thousandths, p_unit_rate_cents, v_line_total_cents,
    p_unit, p_category
  )
  RETURNING line_item_id INTO v_line_item_id;

  -- Recalculate quote totals from all line items
  SELECT coalesce(sum(line_total_cents), 0) INTO v_subtotal
  FROM app_data.quote_line_item
  WHERE quote_id = p_quote_id;

  v_gst := v_subtotal / 10;

  UPDATE app_data.quote
  SET subtotal_cents = v_subtotal,
      gst_cents      = v_gst,
      total_cents    = v_subtotal + v_gst,
      updated_at     = now()
  WHERE quote_id = p_quote_id;

  RETURN v_line_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_add_line_item(uuid, integer, text, bigint, bigint, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_add_line_item(uuid, integer, text, bigint, bigint, text, text) TO authenticated;
