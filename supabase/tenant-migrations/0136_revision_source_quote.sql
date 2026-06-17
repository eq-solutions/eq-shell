-- Migration: 0136_revision_source_quote
-- Target:    Every tenant data-plane (ehow + zaap)
-- Purpose:   Track revision lineage directly on the quote row so the pipeline
--            table can show a "Rev of SKS-XXX" badge without loading audit logs.
--
--            1. Add source_quote_number TEXT to app_data.quote
--            2. Backfill from quote_audit (action='duplicate' entries already logged)
--            3. Replace eq_duplicate_quote  — write source_quote_number at INSERT
--            4. Replace eq_list_quotes      — return source_quote_number
--            5. Replace eq_get_quote_detail — return source_quote_number

-- 1. Column (idempotent)
ALTER TABLE app_data.quote
  ADD COLUMN IF NOT EXISTS source_quote_number TEXT;

-- 2. Backfill from audit log
UPDATE app_data.quote q
SET    source_quote_number = (
         SELECT a.changes->>'source_quote_number'
         FROM   app_data.quote_audit a
         WHERE  a.quote_id = q.quote_id
           AND  a.action   = 'duplicate'
           AND  a.changes ? 'source_quote_number'
         ORDER BY a.created_at
         LIMIT  1
       )
WHERE  q.source_quote_number IS NULL;

-- 3. Replace eq_duplicate_quote — write source_quote_number
CREATE OR REPLACE FUNCTION public.eq_duplicate_quote(p_source_quote_id uuid)
RETURNS TABLE(quote_id uuid, quote_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public'
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
  WHERE q.tenant_id   = v_tenant_id
    AND q.quote_number LIKE 'EQ-%';

  v_quote_num := 'EQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO app_data.quote (
    tenant_id, customer_id, contact_id, site_id, quote_number,
    project_name, attn_name, attn_first_name, attn_phone, address,
    scope_of_works, estimator_name, estimator_initials,
    status, subtotal_cents, gst_cents, total_cents,
    notes, clarifications, validity_days, payment_terms, expires_at,
    imported_from, created_by,
    source_quote_number
  ) VALUES (
    v_tenant_id, v_src.customer_id, v_src.contact_id, v_src.site_id, v_quote_num,
    v_src.project_name, v_src.attn_name, v_src.attn_first_name, v_src.attn_phone, v_src.address,
    v_src.scope_of_works, v_src.estimator_name, v_src.estimator_initials,
    'draft', 0, 0, 0,
    v_src.notes, v_src.clarifications, COALESCE(v_src.validity_days, 30), v_src.payment_terms,
    now() + (COALESCE(v_src.validity_days, 30) || ' days')::interval,
    'eq-shell',
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid,
    v_src.quote_number
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

-- 4. Replace eq_list_quotes — add source_quote_number to return set
CREATE OR REPLACE FUNCTION public.eq_list_quotes(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  quote_id          uuid,
  quote_number      text,
  status            text,
  project_name      text,
  estimator_name    text,
  estimator_initials text,
  subtotal_cents    bigint,
  gst_cents         bigint,
  total_cents       bigint,
  margin_pct        numeric,
  sent_at           timestamptz,
  expires_at        timestamptz,
  follow_up_at      date,
  workbench_job_no  text,
  po_number         text,
  created_at        timestamptz,
  customer_name     text,
  site_name         text,
  site_code         text,
  line_item_count   bigint,
  source_quote_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  RETURN QUERY
  SELECT
    q.quote_id, q.quote_number::text, q.status::text, q.project_name::text,
    q.estimator_name::text, q.estimator_initials::text, q.subtotal_cents,
    q.gst_cents, q.total_cents, q.margin_pct, q.sent_at, q.expires_at,
    q.follow_up_at,
    q.workbench_job_no::text, q.po_number::text, q.created_at,
    c.company_name::text, s.name::text, s.code::text,
    (SELECT count(*)::bigint FROM app_data.quote_line_item qli WHERE qli.quote_id = q.quote_id),
    q.source_quote_number::text
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s ON s.site_id     = q.site_id
  WHERE q.tenant_id  = v_tenant_id
    AND q.deleted_at IS NULL
    AND (p_status IS NULL OR q.status = p_status)
    AND (p_search IS NULL OR (
          q.quote_number      ILIKE '%' || p_search || '%'
       OR q.project_name      ILIKE '%' || p_search || '%'
       OR c.company_name      ILIKE '%' || p_search || '%'
       OR q.workbench_job_no  ILIKE '%' || p_search || '%'
       OR q.po_number         ILIKE '%' || p_search || '%'
       OR s.code              ILIKE '%' || p_search || '%'
       OR s.name              ILIKE '%' || p_search || '%'
    ))
  ORDER BY q.created_at DESC;
END;
$$;

-- 5. Replace eq_get_quote_detail — add source_quote_number to return set
CREATE OR REPLACE FUNCTION public.eq_get_quote_detail(p_quote_id uuid)
RETURNS TABLE(
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
  sent_at             timestamptz,
  expires_at          timestamptz,
  follow_up_at        date,
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
  client_accepted_at  timestamptz,
  client_accepted_by  text,
  client_declined_at  timestamptz,
  loss_reason         text,
  created_at          timestamptz,
  customer_name       text,
  site_name           text,
  site_code           text,
  contact_id          uuid,
  contact_email       text,
  line_items          jsonb,
  notes               jsonb,
  source_quote_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  RETURN QUERY
  SELECT
    q.quote_id, q.customer_id, q.site_id, q.quote_number::text, q.status::text,
    q.project_name::text, q.estimator_name::text, q.estimator_initials::text,
    q.subtotal_cents, q.gst_cents, q.total_cents, q.margin_pct,
    q.sent_at, q.expires_at, q.follow_up_at,
    q.workbench_job_no::text, q.po_number::text, q.coupa_entity::text,
    q.scope_of_works::text, q.clarifications::text, q.notes::text AS quote_notes,
    q.attn_name::text, q.attn_first_name::text, q.attn_phone::text, q.address::text,
    q.payment_terms::text, q.validity_days,
    q.client_accepted_at, q.client_accepted_by::text,
    q.client_declined_at, q.loss_reason::text, q.created_at,
    c.company_name::text  AS customer_name,
    s.name::text          AS site_name,
    s.code::text          AS site_code,
    q.contact_id,
    co.email::text        AS contact_email,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'line_number', qli.line_number, 'description', qli.description,
        'quantity_thousandths', qli.quantity_thousandths, 'unit', qli.unit,
        'unit_rate_cents', qli.unit_rate_cents, 'cost_rate_cents', qli.cost_rate_cents,
        'line_total_cents', qli.line_total_cents, 'category', qli.category
      ) ORDER BY qli.line_number)
      FROM app_data.quote_line_item qli WHERE qli.quote_id = q.quote_id),
      '[]'::jsonb
    ) AS line_items,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'note_id', n.note_id, 'note_type', n.note_type, 'body', n.body,
        'initials', n.created_by_initials, 'created_at', n.created_at
      ) ORDER BY n.created_at DESC)
      FROM app_data.job_notes n WHERE n.quote_id = q.quote_id),
      '[]'::jsonb
    ) AS notes,
    q.source_quote_number::text
  FROM app_data.quote q
  LEFT JOIN app_data.customers c  ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s  ON s.site_id     = q.site_id
  LEFT JOIN app_data.contacts  co ON co.contact_id = q.contact_id
                                  AND co.tenant_id  = v_tenant_id
  WHERE q.quote_id  = p_quote_id
    AND q.tenant_id = v_tenant_id;
END;
$$;
