-- Migration: 0078_eq_create_quote_ambiguity_fix
-- Target:    Per-tenant data plane
-- Purpose:   CRITICAL correctness fix — eq_create_quote has never run successfully.
--
--   The function declares RETURNS TABLE (quote_id uuid, quote_number text), so
--   `quote_number` is an in-scope PL/pgSQL OUT variable. Its sequence query
--       SELECT count(*)+1 ... FROM app_data.quote WHERE ... AND quote_number LIKE 'EQ-%'
--   then references a bare `quote_number`, which Postgres cannot resolve:
--       ERROR 42702: column reference "quote_number" is ambiguous
--   Every native quote-create therefore failed — which is why no EQ-* quotes
--   exist on any tenant. (Caught by Sprint-1 live verification, not by a user.)
--
--   Fix: add `#variable_conflict use_column` so bare column names in queries
--   resolve to the table column (correct for the count and the RETURNING), and
--   alias the table in the sequence query for clarity. OUT column names are left
--   unchanged so the client read (.quote_id / .quote_number) is unaffected.
--
-- Idempotent (CREATE OR REPLACE; signature unchanged from 0075 v4).

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
  p_clarifications       text    DEFAULT NULL
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

  -- Sequential EQ-native quote number: EQ-YYMMDD-NNNN
  SELECT count(*) + 1 INTO v_seq
  FROM app_data.quote q
  WHERE q.tenant_id = v_tenant_id
    AND q.quote_number LIKE 'EQ-%';

  v_quote_num := 'EQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');

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

REVOKE ALL ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text) TO authenticated;
