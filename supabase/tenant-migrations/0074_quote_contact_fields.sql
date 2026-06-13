-- Migration: 0074_quote_contact_fields
-- Target:    Per-tenant data plane
-- Purpose:   Add attn_name, attn_first_name, attn_phone, address, payment_terms,
--            and validity_days (exposed) to eq_create_quote and eq_update_quote
--            so natively-created quotes can populate the Word quote document.
--
-- Also adds: eq_set_po_number — inline PO edit on the detail view.
--
-- All idempotent (CREATE OR REPLACE or DROP + CREATE for signature changes).

-- ============================================================================
-- 1. eq_create_quote v3 — add contact + address + payment_terms params
-- ============================================================================

-- Drop old signature (param count changed)
DROP FUNCTION IF EXISTS public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer);

CREATE FUNCTION public.eq_create_quote(
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
  p_payment_terms        text    DEFAULT NULL
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

  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_data.sites
    WHERE site_id = p_site_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'site not found or access denied';
  END IF;

  -- Sequential EQ-native quote number: EQ-YYMMDD-NNNN
  SELECT count(*) + 1 INTO v_seq
  FROM app_data.quote
  WHERE tenant_id = v_tenant_id
    AND quote_number LIKE 'EQ-%';

  v_quote_num := 'EQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO app_data.quote (
    tenant_id, customer_id, site_id, quote_number,
    project_name, estimator_name, estimator_initials,
    scope_of_works, notes,
    validity_days, expires_at,
    attn_name, attn_first_name, attn_phone, address, payment_terms,
    status, subtotal_cents, gst_cents, total_cents,
    imported_from, created_by
  ) VALUES (
    v_tenant_id, p_customer_id, p_site_id, v_quote_num,
    p_project_name, p_estimator_name, p_estimator_initials,
    p_scope_of_works, p_notes,
    p_validity_days, now() + (p_validity_days || ' days')::interval,
    p_attn_name, p_attn_first_name, p_attn_phone, p_address, p_payment_terms,
    'draft', 0, 0, 0,
    'eq-shell',
    (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
  )
  RETURNING quote_id INTO v_quote_id;

  RETURN QUERY SELECT v_quote_id, v_quote_num;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text) TO authenticated;

-- ============================================================================
-- 2. eq_update_quote v2 — add contact + address + payment_terms params
-- ============================================================================

-- Drop old signature (param count changed)
DROP FUNCTION IF EXISTS public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer);

CREATE FUNCTION public.eq_update_quote(
  p_quote_id             uuid,
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
  p_payment_terms        text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_status    text;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT status INTO v_status
  FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  IF v_status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'quote can only be edited in draft or submitted status';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.customers
    WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'customer not found or access denied';
  END IF;

  UPDATE app_data.quote
  SET
    customer_id        = p_customer_id,
    site_id            = p_site_id,
    project_name       = p_project_name,
    estimator_name     = p_estimator_name,
    estimator_initials = p_estimator_initials,
    scope_of_works     = p_scope_of_works,
    notes              = p_notes,
    validity_days      = p_validity_days,
    expires_at         = now() + (p_validity_days || ' days')::interval,
    attn_name          = p_attn_name,
    attn_first_name    = p_attn_first_name,
    attn_phone         = p_attn_phone,
    address            = p_address,
    payment_terms      = p_payment_terms,
    updated_at         = now()
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text) TO authenticated;

-- ============================================================================
-- 3. eq_set_po_number — inline PO edit on detail view
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_set_po_number(
  p_quote_id  uuid,
  p_po_number text,
  p_initials  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  UPDATE app_data.quote
  SET po_number  = p_po_number,
      updated_at = now()
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  INSERT INTO app_data.job_notes
    (tenant_id, quote_id, body, note_type, created_by_initials)
  VALUES
    (v_tenant_id, p_quote_id, 'PO set: ' || p_po_number, 'system', p_initials);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_po_number(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_set_po_number(uuid, text, text) TO authenticated;
