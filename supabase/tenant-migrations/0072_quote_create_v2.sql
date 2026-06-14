-- Migration: 0072_quote_create_v2
-- Target:    Per-tenant data plane
-- Purpose:   Close gaps between native create form and existing quote data.
--
--   eq_list_sites(p_customer_id)  — site picker for create form
--   eq_create_quote v2            — adds p_site_id parameter
--   eq_update_quote_status v2     — also writes to job_notes for audit trail
--
-- All idempotent (CREATE OR REPLACE).

-- ============================================================================
-- 1. eq_list_sites — site picker
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_sites(
  p_customer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  site_id     uuid,
  name        text,
  code        text,
  customer_id uuid
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
    s.site_id,
    s.name::text,
    s.code::text,
    s.customer_id
  FROM app_data.sites s
  WHERE s.tenant_id = v_tenant_id
    AND s.active    = true
    AND (p_customer_id IS NULL OR s.customer_id = p_customer_id)
  ORDER BY s.name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_sites(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_sites(uuid) TO authenticated;

-- ============================================================================
-- 2. eq_create_quote v2 — add p_site_id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_create_quote(
  p_customer_id          uuid,
  p_site_id              uuid    DEFAULT NULL,
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
    status, subtotal_cents, gst_cents, total_cents,
    imported_from, created_by
  ) VALUES (
    v_tenant_id, p_customer_id, p_site_id, v_quote_num,
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

-- Old 7-arg signature superseded — revoke if it exists (may be absent on planes where 0070 had partial state)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_create_quote'
      AND array_length(p.proargtypes, 1) = 7
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.eq_create_quote(uuid, text, text, text, text, text, integer) FROM PUBLIC';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer) TO authenticated;

-- ============================================================================
-- 3. eq_update_quote_status v2 — also write to job_notes for audit trail
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_update_quote_status(
  p_quote_id   uuid,
  p_new_status text,
  p_note       text DEFAULT NULL,
  p_initials   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_old_status text;
  v_note_body  text;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT status INTO v_old_status
  FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  UPDATE app_data.quote
  SET status     = p_new_status,
      updated_at = now()
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  INSERT INTO app_data.quote_status_history
    (tenant_id, quote_id, from_status, to_status, changed_by_initials, note, changed_at)
  VALUES
    (v_tenant_id, p_quote_id, v_old_status, p_new_status, p_initials, p_note, now());

  -- Write audit note to job_notes so the detail panel shows status history
  v_note_body := v_old_status || ' → ' || p_new_status
    || CASE WHEN p_note IS NOT NULL AND p_note <> '' THEN ': ' || p_note ELSE '' END;

  INSERT INTO app_data.job_notes
    (tenant_id, quote_id, body, note_type, created_by_initials)
  VALUES
    (v_tenant_id, p_quote_id, v_note_body, 'status-change', p_initials);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) TO authenticated;
