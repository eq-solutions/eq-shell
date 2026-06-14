-- Migration: 0094_job_creation_data
-- Target:    Per-tenant data plane
-- Purpose:   Data source for the server-side Job Creation generator.
--
--   The Workbench Job Creation sheet (ported from eq-quotes-port
--   app/quotes/job_creation.py) needs, per quote: project name, customer name +
--   ABN + invoice email, subtotal ex GST, and the line items WITH their cost rate
--   and category (the Budget tab buckets cost into MAT/SLAB/SUBC). eq_get_quote_detail
--   doesn't expose cost_rate_cents or the customer ABN/email, so this returns
--   exactly what the generator needs in one tenant-scoped call.
--
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.eq_get_job_creation(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_result    jsonb;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT jsonb_build_object(
    'quote_number',   q.quote_number,
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

REVOKE ALL ON FUNCTION public.eq_get_job_creation(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_get_job_creation(uuid) TO authenticated;
