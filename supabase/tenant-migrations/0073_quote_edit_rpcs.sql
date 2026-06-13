-- Migration: 0073_quote_edit_rpcs
-- Target:    Per-tenant data plane
-- Purpose:   Quote edit mode and status-field hygiene.
--
--   eq_get_quote_detail v3  — adds customer_id, site_id, quote_notes to output
--   eq_update_quote         — new: edit header of draft/submitted quotes
--   eq_replace_line_items   — new: atomic line-item swap + recalc totals
--   eq_update_quote_status v3 — sets sent_at on → submitted, loss_reason on → lost
--
-- All idempotent (CREATE OR REPLACE).

-- ============================================================================
-- 1. eq_get_quote_detail v3 — add customer_id, site_id, quote_notes
-- ============================================================================

-- DROP first: adding columns changes the return type, which CREATE OR REPLACE rejects
DROP FUNCTION IF EXISTS public.eq_get_quote_detail(uuid);

CREATE FUNCTION public.eq_get_quote_detail(p_quote_id uuid)
RETURNS TABLE (
  quote_id            uuid,
  customer_id         uuid,
  site_id             uuid,
  quote_number        text,
  status              text,
  project_name        text,
  estimator_name      text,
  estimator_initials  text,
  subtotal_cents      bigint,
  gst_cents           bigint,
  total_cents         bigint,
  margin_pct          numeric,
  sent_at             timestamp with time zone,
  expires_at          timestamp with time zone,
  workbench_job_no    text,
  po_number           text,
  coupa_entity        text,
  scope_of_works      text,
  quote_notes         text,
  attn_name           text,
  attn_first_name     text,
  attn_phone          text,
  address             text,
  payment_terms       text,
  validity_days       integer,
  client_accepted_at  timestamp with time zone,
  client_accepted_by  text,
  client_declined_at  timestamp with time zone,
  loss_reason         text,
  created_at          timestamp with time zone,
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
    q.customer_id,
    q.site_id,
    q.quote_number::text,
    q.status::text,
    q.project_name::text,
    q.estimator_name::text,
    q.estimator_initials::text,
    q.subtotal_cents,
    q.gst_cents,
    q.total_cents,
    q.margin_pct,
    q.sent_at,
    q.expires_at,
    q.workbench_job_no::text,
    q.po_number::text,
    q.coupa_entity::text,
    q.scope_of_works::text,
    q.notes::text           AS quote_notes,
    q.attn_name::text,
    q.attn_first_name::text,
    q.attn_phone::text,
    q.address::text,
    q.payment_terms::text,
    q.validity_days,
    q.client_accepted_at,
    q.client_accepted_by::text,
    q.client_declined_at,
    q.loss_reason::text,
    q.created_at,
    c.company_name::text    AS customer_name,
    s.name::text            AS site_name,
    s.code::text            AS site_code,
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
-- 2. eq_update_quote — edit header fields (draft or submitted only)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_update_quote(
  p_quote_id             uuid,
  p_customer_id          uuid,
  p_site_id              uuid    DEFAULT NULL,
  p_project_name         text    DEFAULT NULL,
  p_estimator_name       text    DEFAULT NULL,
  p_estimator_initials   text    DEFAULT NULL,
  p_scope_of_works       text    DEFAULT NULL,
  p_notes                text    DEFAULT NULL,
  p_validity_days        integer DEFAULT 30
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
    updated_at         = now()
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer) TO authenticated;

-- ============================================================================
-- 3. eq_replace_line_items — delete all + re-insert from JSONB, recalc totals
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_replace_line_items(
  p_quote_id   uuid,
  p_line_items jsonb
  -- [{line_number, description, qty_thousandths, unit_rate_cents, unit, category}, ...]
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
  v_subtotal     bigint;
  v_gst          bigint;
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
      unit, category
    ) VALUES (
      v_tenant_id,
      p_quote_id,
      (v_item->>'line_number')::integer,
      v_item->>'description',
      (v_item->>'qty_thousandths')::bigint,
      (v_item->>'unit_rate_cents')::bigint,
      v_line_total,
      NULLIF(trim(v_item->>'unit'), ''),
      NULLIF(trim(v_item->>'category'), '')
    );
  END LOOP;

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
END;
$$;

REVOKE ALL ON FUNCTION public.eq_replace_line_items(uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_replace_line_items(uuid, jsonb) TO authenticated;

-- ============================================================================
-- 4. eq_update_quote_status v3 — sent_at on submit, loss_reason on lost
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
  SET
    status           = p_new_status,
    updated_at       = now(),
    -- Set sent_at/sent_by only on first submit
    sent_at          = CASE
                         WHEN p_new_status = 'submitted' AND sent_at IS NULL
                         THEN now() ELSE sent_at
                       END,
    sent_by_initials = CASE
                         WHEN p_new_status = 'submitted' AND sent_by_initials IS NULL
                         THEN p_initials ELSE sent_by_initials
                       END,
    -- Store loss reason on the quote record
    loss_reason      = CASE
                         WHEN p_new_status = 'lost'
                         THEN COALESCE(p_note, loss_reason) ELSE loss_reason
                       END
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  INSERT INTO app_data.quote_status_history
    (tenant_id, quote_id, from_status, to_status, changed_by_initials, note, changed_at)
  VALUES
    (v_tenant_id, p_quote_id, v_old_status, p_new_status, p_initials, p_note, now());

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
