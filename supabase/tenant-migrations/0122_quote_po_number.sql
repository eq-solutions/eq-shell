-- Migration: 0122_quote_po_number
-- Target:    Per-tenant data plane
-- Purpose:   Ensure po_number column exists on quote table (may already exist from
--            earlier work) and update eq_get_job_creation to return it.

ALTER TABLE app_data.quote ADD COLUMN IF NOT EXISTS po_number text;

CREATE OR REPLACE FUNCTION public.eq_get_job_creation(
  p_quote_id  uuid,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_result    jsonb;
BEGIN
  v_tenant_id := COALESCE(
    p_tenant_id,
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid
  );

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id required';
  END IF;

  SELECT jsonb_build_object(
    'quote_number',   q.quote_number,
    'po_number',      q.po_number,
    'project_name',   q.project_name,
    'customer_name',  c.company_name,
    'customer_abn',   c.abn,
    'customer_email', c.email,
    'estimator_name', q.estimator_name,
    'subtotal_cents', q.subtotal_cents,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category',        li.category,
        'qty_thousandths', li.quantity_thousandths,
        'unit_rate_cents', li.unit_rate_cents,
        'cost_rate_cents', li.cost_rate_cents
      ) ORDER BY li.line_number)
      FROM app_data.quote_line_item li
      WHERE li.quote_id = q.quote_id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  WHERE q.quote_id = p_quote_id AND q.tenant_id = v_tenant_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_get_job_creation(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_get_job_creation(uuid, uuid) TO authenticated;
