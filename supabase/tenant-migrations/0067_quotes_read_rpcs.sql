-- Migration: 0067_quotes_read_rpcs
-- Target:    Per-tenant data plane (ehowgjardagevnrluult + future tenants)
-- Purpose:   Shell-callable RPCs for the EQ Ops quotes pipeline module (Track B).
--            All SECURITY DEFINER, tenant-scoped from JWT app_metadata.tenant_id,
--            grantable to authenticated (browser-safe).
--
--   eq_list_quotes(p_status, p_search)   — pipeline list with customer+site join
--   eq_get_quote_detail(p_quote_id)       — single quote + line items JSONB + notes JSONB
--   eq_update_quote_status(...)           — status transition + history row
--   eq_add_quote_note(...)               — append-only note
--   eq_list_client_groups()             — Equinix accordion data
--   eq_match_coupa_po(...)              — PO import: site-code match → po_number + status
--
-- Idempotent (CREATE OR REPLACE).

-- ============================================================================
-- 1. eq_list_quotes — pipeline list
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_quotes(
  p_status  text DEFAULT NULL,
  p_search  text DEFAULT NULL
)
RETURNS TABLE (
  quote_id            uuid,
  quote_number        text,
  status              text,
  project_name        text,
  estimator_name      text,
  estimator_initials  text,
  subtotal_cents      bigint,
  gst_cents           bigint,
  total_cents         bigint,
  margin_pct          numeric,
  sent_at             timestamptz,
  expires_at          timestamptz,
  workbench_job_no    text,
  po_number           text,
  created_at          timestamptz,
  customer_name       text,
  site_name           text,
  site_code           text,
  line_item_count     bigint
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
    q.quote_id,
    q.quote_number,
    q.status,
    q.project_name,
    q.estimator_name,
    q.estimator_initials,
    q.subtotal_cents,
    q.gst_cents,
    q.total_cents,
    q.margin_pct,
    q.sent_at,
    q.expires_at,
    q.workbench_job_no,
    q.po_number,
    q.created_at,
    c.company_name                                                        AS customer_name,
    s.name                                                                AS site_name,
    s.code                                                                AS site_code,
    (SELECT count(*)::bigint FROM app_data.quote_line_item qli
       WHERE qli.quote_id = q.quote_id)                                   AS line_item_count
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s ON s.site_id     = q.site_id
  WHERE q.tenant_id = v_tenant_id
    AND (p_status IS NULL OR q.status = p_status)
    AND (p_search IS NULL OR (
          q.quote_number ILIKE '%' || p_search || '%'
       OR q.project_name ILIKE '%' || p_search || '%'
       OR c.company_name ILIKE '%' || p_search || '%'
    ))
  ORDER BY q.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_quotes(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_quotes(text, text) TO authenticated;

-- ============================================================================
-- 2. eq_get_quote_detail — single quote + line items + notes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_get_quote_detail(
  p_quote_id uuid
)
RETURNS TABLE (
  quote_id            uuid,
  quote_number        text,
  status              text,
  project_name        text,
  estimator_name      text,
  estimator_initials  text,
  subtotal_cents      bigint,
  gst_cents           bigint,
  total_cents         bigint,
  margin_pct          numeric,
  sent_at             timestamptz,
  expires_at          timestamptz,
  workbench_job_no    text,
  po_number           text,
  coupa_entity        text,
  scope_of_works      text,
  attn_name           text,
  attn_first_name     text,
  attn_phone          text,
  address             text,
  payment_terms       text,
  validity_days       integer,
  client_accepted_at  timestamptz,
  client_accepted_by  text,
  client_declined_at  timestamptz,
  loss_reason         text,
  created_at          timestamptz,
  customer_name       text,
  site_name           text,
  site_code           text,
  line_items          jsonb,
  notes               jsonb
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
    q.quote_id,
    q.quote_number,
    q.status,
    q.project_name,
    q.estimator_name,
    q.estimator_initials,
    q.subtotal_cents,
    q.gst_cents,
    q.total_cents,
    q.margin_pct,
    q.sent_at,
    q.expires_at,
    q.workbench_job_no,
    q.po_number,
    q.coupa_entity,
    q.scope_of_works,
    q.attn_name,
    q.attn_first_name,
    q.attn_phone,
    q.address,
    q.payment_terms,
    q.validity_days,
    q.client_accepted_at,
    q.client_accepted_by,
    q.client_declined_at,
    q.loss_reason,
    q.created_at,
    c.company_name AS customer_name,
    s.name         AS site_name,
    s.code         AS site_code,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'line_number',          qli.line_number,
          'description',          qli.description,
          'quantity_thousandths', qli.quantity_thousandths,
          'unit',                 qli.unit,
          'unit_rate_cents',      qli.unit_rate_cents,
          'line_total_cents',     qli.line_total_cents,
          'category',             qli.category
        ) ORDER BY qli.line_number
      ) FROM app_data.quote_line_item qli WHERE qli.quote_id = q.quote_id),
      '[]'::jsonb
    ) AS line_items,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'note_id',    n.note_id,
          'note_type',  n.note_type,
          'body',       n.body,
          'initials',   n.created_by_initials,
          'created_at', n.created_at
        ) ORDER BY n.created_at DESC
      ) FROM app_data.job_notes n WHERE n.quote_id = q.quote_id),
      '[]'::jsonb
    ) AS notes
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s ON s.site_id     = q.site_id
  WHERE q.quote_id  = p_quote_id
    AND q.tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_get_quote_detail(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_get_quote_detail(uuid) TO authenticated;

-- ============================================================================
-- 3. eq_update_quote_status — status transition + history
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_update_quote_status(
  p_quote_id   uuid,
  p_new_status text,
  p_note       text  DEFAULT NULL,
  p_initials   text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_old_status text;
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
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) TO authenticated;

-- ============================================================================
-- 4. eq_add_quote_note — append-only note
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_add_quote_note(
  p_quote_id   uuid,
  p_body       text,
  p_note_type  text DEFAULT 'manual',
  p_initials   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_note_id   uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.quote
    WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  INSERT INTO app_data.job_notes
    (tenant_id, quote_id, body, note_type, created_by_initials)
  VALUES
    (v_tenant_id, p_quote_id, p_body, p_note_type, p_initials)
  RETURNING note_id INTO v_note_id;

  RETURN v_note_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_add_quote_note(uuid, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_add_quote_note(uuid, text, text, text) TO authenticated;

-- ============================================================================
-- 5. eq_list_client_groups — accordion data
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_client_groups()
RETURNS TABLE (
  group_id      uuid,
  group_name    text,
  group_slug    text,
  customer_id   uuid,
  customer_name text,
  site_codes    text[]
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
    cg.group_id,
    cg.name       AS group_name,
    cg.slug       AS group_slug,
    cgm.customer_id,
    c.company_name AS customer_name,
    cgm.site_codes
  FROM app_data.client_groups       cg
  JOIN app_data.client_group_members cgm ON cgm.group_id   = cg.group_id
  JOIN app_data.customers            c   ON c.customer_id  = cgm.customer_id
  WHERE cg.tenant_id = v_tenant_id
  ORDER BY cg.name, c.company_name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_client_groups() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_client_groups() TO authenticated;

-- ============================================================================
-- 6. eq_match_coupa_po — PO import: match site code → quote → update
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_match_coupa_po(
  p_po_number    text,
  p_site_code    text,
  p_coupa_entity text  DEFAULT NULL,
  p_initials     text  DEFAULT NULL
)
RETURNS TABLE (
  quote_id     uuid,
  quote_number text,
  matched      boolean,
  message      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_quote_id   uuid;
  v_qnum       text;
  v_old_status text;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  -- Find the most recent open quote for this site code via client_group_members
  SELECT q.quote_id, q.quote_number, q.status INTO v_quote_id, v_qnum, v_old_status
  FROM app_data.quote q
  JOIN app_data.customers            c   ON c.customer_id  = q.customer_id
  JOIN app_data.client_group_members cgm ON cgm.customer_id = c.customer_id
  WHERE q.tenant_id = v_tenant_id
    AND p_site_code = ANY(cgm.site_codes)
    AND q.status IN ('verbal-win', 'won-awaiting-job-no', 'won-job-created', 'submitted')
    AND q.po_number IS NULL
  ORDER BY q.created_at DESC
  LIMIT 1;

  IF v_quote_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, false, 'No matching open quote for site code ' || p_site_code;
    RETURN;
  END IF;

  UPDATE app_data.quote
  SET po_number    = p_po_number,
      coupa_entity = p_coupa_entity,
      status       = 'po-matched',
      updated_at   = now()
  WHERE quote_id = v_quote_id;

  INSERT INTO app_data.quote_status_history
    (tenant_id, quote_id, from_status, to_status, changed_by_initials, note, changed_at)
  VALUES
    (v_tenant_id, v_quote_id, v_old_status, 'po-matched',
     p_initials, 'Coupa PO ' || p_po_number || ' matched', now());

  RETURN QUERY SELECT v_quote_id, v_qnum, true, 'Matched to ' || v_qnum;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_match_coupa_po(text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_match_coupa_po(text, text, text, text) TO authenticated;
