-- Migration: 0088_eq_duplicate_quote
-- Target:    Per-tenant data plane
-- Purpose:   Duplicate a quote — clone header + line items into a fresh draft.
--
--   Copies the header (customer, contact, site, project, scope, contact block,
--   clarifications, notes, payment terms, validity) and every line item. The copy
--   starts at status 'draft' with a new EQ-YYMMDD-NNNN number; sent/PO/job-no/
--   accept/decline/loss fields are intentionally NOT copied. Totals are recomputed
--   from the copied lines via the shared helper, and a 'duplicate' audit row is
--   written pointing back to the source.
--
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.eq_duplicate_quote(p_source_quote_id uuid)
RETURNS TABLE (quote_id uuid, quote_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_new_id    uuid;
  v_seq       bigint;
  v_quote_num text;
  v_src       app_data.quote%ROWTYPE;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT * INTO v_src
  FROM app_data.quote q
  WHERE q.quote_id = p_source_quote_id AND q.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  SELECT count(*) + 1 INTO v_seq
  FROM app_data.quote q
  WHERE q.tenant_id = v_tenant_id
    AND q.quote_number LIKE 'EQ-%';

  v_quote_num := 'EQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO app_data.quote (
    tenant_id, customer_id, contact_id, site_id, quote_number,
    project_name, attn_name, attn_first_name, attn_phone, address,
    scope_of_works, estimator_name, estimator_initials,
    status, subtotal_cents, gst_cents, total_cents,
    notes, clarifications, validity_days, payment_terms, expires_at,
    imported_from, created_by
  ) VALUES (
    v_tenant_id, v_src.customer_id, v_src.contact_id, v_src.site_id, v_quote_num,
    v_src.project_name, v_src.attn_name, v_src.attn_first_name, v_src.attn_phone, v_src.address,
    v_src.scope_of_works, v_src.estimator_name, v_src.estimator_initials,
    'draft', 0, 0, 0,
    v_src.notes, v_src.clarifications, COALESCE(v_src.validity_days, 30), v_src.payment_terms,
    now() + (COALESCE(v_src.validity_days, 30) || ' days')::interval,
    'eq-shell',
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  )
  RETURNING quote.quote_id INTO v_new_id;

  INSERT INTO app_data.quote_line_item (
    tenant_id, quote_id, line_number,
    description, quantity_thousandths, unit_rate_cents, line_total_cents,
    unit, category, cost_rate_cents
  )
  SELECT
    v_tenant_id, v_new_id, qli.line_number,
    qli.description, qli.quantity_thousandths, qli.unit_rate_cents, qli.line_total_cents,
    qli.unit, qli.category, qli.cost_rate_cents
  FROM app_data.quote_line_item qli
  WHERE qli.quote_id = p_source_quote_id AND qli.tenant_id = v_tenant_id;

  PERFORM public.eq__recompute_quote_totals(v_new_id);
  PERFORM public.eq__log_quote_audit(
    v_new_id, 'duplicate',
    jsonb_build_object('source_quote_id', p_source_quote_id, 'source_quote_number', v_src.quote_number),
    v_src.estimator_initials
  );

  RETURN QUERY SELECT v_new_id, v_quote_num;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_duplicate_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eq_duplicate_quote(uuid) TO authenticated;
