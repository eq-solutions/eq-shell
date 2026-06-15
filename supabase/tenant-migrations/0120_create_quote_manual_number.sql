-- Migration: 0120_create_quote_manual_number
-- Target:    Per-tenant data plane (ehowgjardagevnrluult + future tenants)
-- Purpose:   Allow callers to pass p_quote_number to eq_create_quote.
--            When provided, it is used as-is; when NULL or blank the function
--            falls back to the legacy EQ-YYMMDD-NNNN auto-numbering.
--
-- Idempotent (CREATE OR REPLACE). Signature adds one DEFAULT NULL param at the
-- end, so all existing callers continue to work without changes.

CREATE OR REPLACE FUNCTION public.eq_create_quote(
  p_customer_id          uuid,
  p_site_id              uuid    DEFAULT NULL,
  p_project_name         text    DEFAULT NULL,
  p_estimator_name       text    DEFAULT NULL,
  p_estimator_initials   text    DEFAULT NULL,
  p_scope_of_works       text    DEFAULT NULL,
  p_notes                text    DEFAULT NULL,
  p_validity_days        integer DEFAULT 30,
  p_attn_name            text    DEFAULT NULL,
  p_attn_first_name      text    DEFAULT NULL,
  p_attn_phone           text    DEFAULT NULL,
  p_address              text    DEFAULT NULL,
  p_payment_terms        text    DEFAULT NULL,
  p_clarifications       text    DEFAULT NULL,
  p_quote_number         text    DEFAULT NULL
)
RETURNS TABLE (
  quote_id     uuid,
  quote_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id  uuid;
  v_quote_id   uuid;
  v_seq        bigint;
  v_quote_num  text;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.customers c
    WHERE c.customer_id = p_customer_id AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'customer not found or access denied';
  END IF;

  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_data.sites s
    WHERE s.site_id = p_site_id AND s.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'site not found or access denied';
  END IF;

  -- Use caller-supplied number when provided; otherwise auto-generate.
  IF p_quote_number IS NOT NULL AND trim(p_quote_number) <> '' THEN
    v_quote_num := trim(p_quote_number);
  ELSE
    SELECT count(*) + 1 INTO v_seq
    FROM app_data.quote q
    WHERE q.tenant_id = v_tenant_id
      AND q.quote_number LIKE 'EQ-%';
    v_quote_num := 'EQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');
  END IF;

  INSERT INTO app_data.quote (
    tenant_id, customer_id, site_id, quote_number,
    project_name, estimator_name, estimator_initials,
    scope_of_works, notes, clarifications,
    validity_days, expires_at,
    attn_name, attn_first_name, attn_phone, address, payment_terms,
    status, subtotal_cents, gst_cents, total_cents,
    imported_from, created_by
  ) VALUES (
    v_tenant_id, p_customer_id, p_site_id, v_quote_num,
    p_project_name, p_estimator_name, p_estimator_initials,
    p_scope_of_works, p_notes, p_clarifications,
    p_validity_days, now() + (p_validity_days || ' days')::interval,
    p_attn_name, p_attn_first_name, p_attn_phone, p_address, p_payment_terms,
    'draft', 0, 0, 0,
    'eq-shell',
    (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
  )
  RETURNING quote.quote_id INTO v_quote_id;

  RETURN QUERY SELECT v_quote_id, v_quote_num;
END;
$$;

-- Drop the old 14-param overload so Postgres resolves the call unambiguously.
DROP FUNCTION IF EXISTS public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text);

REVOKE ALL ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text, text) TO authenticated;
