-- Migration: 0075_quote_cost_clarifications
-- Target:    Per-tenant data plane
-- Purpose:
--   1. quote_line_item — add cost_rate_cents (for margin tracking)
--   2. quote — add clarifications text column
--   3. quote_templates — scope + clarification snippet library
--   4. Update eq_add_line_item + eq_replace_line_items to accept cost_rate_cents
--   5. Update eq_create_quote + eq_update_quote to accept p_clarifications
--   6. New: eq_list_quote_templates, eq_upsert_quote_template, eq_archive_quote_template

-- ============================================================================
-- 1. Schema additions
-- ============================================================================

ALTER TABLE app_data.quote_line_item
  ADD COLUMN IF NOT EXISTS cost_rate_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE app_data.quote
  ADD COLUMN IF NOT EXISTS clarifications text;

ALTER TABLE app_data.quote
  ADD COLUMN IF NOT EXISTS margin_pct numeric(6,2);

-- ============================================================================
-- 2. quote_templates — scope + clarification library
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.quote_templates (
  template_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  template_type text        NOT NULL CHECK (template_type IN ('scope', 'clarification')),
  name          text        NOT NULL,
  body          text        NOT NULL,
  sort_order    integer     NOT NULL DEFAULT 0,
  archived      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_data.quote_templates
  ENABLE ROW LEVEL SECURITY;

-- RLS: tenant-scoped (service role bypasses)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'quote_templates' AND policyname = 'tenant_iso'
  ) THEN
    CREATE POLICY tenant_iso ON app_data.quote_templates
      USING (tenant_id = (
        (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid
      ));
  END IF;
END $$;

-- ============================================================================
-- 3. eq_add_line_item — accept cost_rate_cents
-- ============================================================================

DROP FUNCTION IF EXISTS public.eq_add_line_item(uuid, integer, text, bigint, bigint, text, text);

CREATE FUNCTION public.eq_add_line_item(
  p_quote_id           uuid,
  p_line_number        integer,
  p_description        text,
  p_qty_thousandths    bigint,
  p_unit_rate_cents    bigint,
  p_unit               text    DEFAULT NULL,
  p_category           text    DEFAULT NULL,
  p_cost_rate_cents    bigint  DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_line_total  bigint;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  v_line_total := (p_qty_thousandths * p_unit_rate_cents) / 1000;

  INSERT INTO app_data.quote_line_item (
    tenant_id, quote_id, line_number,
    description, quantity_thousandths, unit_rate_cents, line_total_cents,
    unit, category, cost_rate_cents
  ) VALUES (
    v_tenant_id, p_quote_id, p_line_number,
    p_description, p_qty_thousandths, p_unit_rate_cents, v_line_total,
    NULLIF(trim(p_unit), ''), NULLIF(trim(p_category), ''),
    COALESCE(p_cost_rate_cents, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_add_line_item(uuid, integer, text, bigint, bigint, text, text, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_add_line_item(uuid, integer, text, bigint, bigint, text, text, bigint) TO authenticated;

-- ============================================================================
-- 4. eq_replace_line_items v2 — accept cost_rate_cents in items JSONB
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_replace_line_items(
  p_quote_id   uuid,
  p_line_items jsonb
  -- [{line_number, description, qty_thousandths, unit_rate_cents, unit, category, cost_rate_cents?}, ...]
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
  v_cost_total   bigint := 0;
  v_sell_total   bigint := 0;
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
      unit, category, cost_rate_cents
    ) VALUES (
      v_tenant_id,
      p_quote_id,
      (v_item->>'line_number')::integer,
      v_item->>'description',
      (v_item->>'qty_thousandths')::bigint,
      (v_item->>'unit_rate_cents')::bigint,
      v_line_total,
      NULLIF(trim(v_item->>'unit'), ''),
      NULLIF(trim(v_item->>'category'), ''),
      COALESCE((v_item->>'cost_rate_cents')::bigint, 0)
    );

    v_sell_total := v_sell_total + v_line_total;
    v_cost_total := v_cost_total + (
      (v_item->>'qty_thousandths')::bigint *
      COALESCE((v_item->>'cost_rate_cents')::bigint, 0)
    ) / 1000;
  END LOOP;

  v_subtotal := v_sell_total;
  v_gst      := v_subtotal / 10;

  UPDATE app_data.quote
  SET subtotal_cents = v_subtotal,
      gst_cents      = v_gst,
      total_cents    = v_subtotal + v_gst,
      -- margin = (sell - cost) / sell × 100, null-safe
      margin_pct     = CASE WHEN v_subtotal > 0
                         THEN round(((v_subtotal - v_cost_total)::numeric / v_subtotal) * 100, 2)
                         ELSE NULL END,
      updated_at     = now()
  WHERE quote_id = p_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_replace_line_items(uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_replace_line_items(uuid, jsonb) TO authenticated;

-- ============================================================================
-- 5. eq_create_quote v4 — add p_clarifications
-- ============================================================================

DROP FUNCTION IF EXISTS public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text);

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

  SELECT count(*) + 1 INTO v_seq
  FROM app_data.quote
  WHERE tenant_id = v_tenant_id
    AND quote_number LIKE 'EQ-%';

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
  RETURNING quote_id INTO v_quote_id;

  RETURN QUERY SELECT v_quote_id, v_quote_num;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_create_quote(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text) TO authenticated;

-- ============================================================================
-- 6. eq_update_quote v3 — add p_clarifications
-- ============================================================================

DROP FUNCTION IF EXISTS public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text);

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
  p_payment_terms        text    DEFAULT NULL,
  p_clarifications       text    DEFAULT NULL
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
    clarifications     = p_clarifications,
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

REVOKE ALL ON FUNCTION public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote(uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text) TO authenticated;

-- ============================================================================
-- 7. eq_list_quote_templates — scope/clarification snippet library
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_quote_templates(
  p_type text DEFAULT NULL  -- 'scope' | 'clarification' | NULL (all)
)
RETURNS TABLE (
  template_id   uuid,
  template_type text,
  name          text,
  body          text,
  sort_order    integer
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
  SELECT t.template_id, t.template_type::text, t.name::text, t.body::text, t.sort_order
  FROM app_data.quote_templates t
  WHERE t.tenant_id = v_tenant_id
    AND t.archived = false
    AND (p_type IS NULL OR t.template_type = p_type)
  ORDER BY t.template_type, t.sort_order, t.name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_quote_templates(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_quote_templates(text) TO authenticated;

-- ============================================================================
-- 8. eq_upsert_quote_template — create or update a template
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_upsert_quote_template(
  p_template_id   uuid    DEFAULT NULL,  -- NULL = create new
  p_template_type text    DEFAULT 'scope',
  p_name          text    DEFAULT '',
  p_body          text    DEFAULT '',
  p_sort_order    integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_id        uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF p_template_id IS NULL THEN
    INSERT INTO app_data.quote_templates
      (tenant_id, template_type, name, body, sort_order)
    VALUES
      (v_tenant_id, p_template_type, p_name, p_body, p_sort_order)
    RETURNING template_id INTO v_id;
  ELSE
    UPDATE app_data.quote_templates
    SET name          = p_name,
        body          = p_body,
        sort_order    = p_sort_order,
        updated_at    = now()
    WHERE template_id = p_template_id AND tenant_id = v_tenant_id;
    v_id := p_template_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_upsert_quote_template(uuid, text, text, text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_upsert_quote_template(uuid, text, text, text, integer) TO authenticated;

-- ============================================================================
-- 9. eq_archive_quote_template
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_archive_quote_template(
  p_template_id uuid,
  p_archived    boolean DEFAULT true
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

  UPDATE app_data.quote_templates
  SET archived   = p_archived,
      updated_at = now()
  WHERE template_id = p_template_id AND tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_archive_quote_template(uuid, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_archive_quote_template(uuid, boolean) TO authenticated;

-- ============================================================================
-- 10. eq_get_quote_detail v4 — include clarifications + cost_rate_cents
-- ============================================================================

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
  clarifications      text,
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
    q.clarifications::text,
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
          'cost_rate_cents',      qli.cost_rate_cents,
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
