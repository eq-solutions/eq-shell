-- Migration: 0119_fix_quote_detail_add_estimators
-- Target:    Per-tenant data plane (ehowgjardagevnrluult + future tenants)
-- Purpose:
--   1. Fix eq_get_quote_detail: inner -> 'tenant_id' was returning jsonb which
--      cannot be cast to uuid. Changed to ->> to extract as text first.
--      (Same bug was already fixed in eq_list_quotes in mig 0117.)
--   2. Add app_data.quote_estimators table — a simple name/initials list
--      managed in EQ Ops Setup, isolated from app_data.staff.
--   3. eq_list_estimators()   — list active estimators for the tenant
--   4. eq_upsert_estimator()  — create or update an estimator
--   5. eq_archive_estimator() — soft-delete (active = false)

-- ============================================================================
-- 1. Fix eq_get_quote_detail
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_get_quote_detail(p_quote_id uuid)
RETURNS TABLE(
  quote_id uuid, customer_id uuid, site_id uuid, quote_number text,
  status text, project_name text, estimator_name text, estimator_initials text,
  subtotal_cents bigint, gst_cents bigint, total_cents bigint, margin_pct numeric,
  sent_at timestamptz, expires_at timestamptz, follow_up_at date,
  workbench_job_no text, po_number text, coupa_entity text,
  scope_of_works text, clarifications text, quote_notes text,
  attn_name text, attn_first_name text, attn_phone text, address text,
  payment_terms text, validity_days integer,
  client_accepted_at timestamptz, client_accepted_by text,
  client_declined_at timestamptz, loss_reason text, created_at timestamptz,
  customer_name text, site_name text, site_code text,
  contact_id uuid, contact_email text, line_items jsonb, notes jsonb
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
    c.company_name::text AS customer_name,
    s.name::text AS site_name,
    s.code::text AS site_code,
    q.contact_id,
    co.email::text AS contact_email,
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
    ) AS notes
  FROM app_data.quote q
  LEFT JOIN app_data.customers c  ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s  ON s.site_id     = q.site_id
  LEFT JOIN app_data.contacts  co ON co.contact_id = q.contact_id
                                  AND co.tenant_id  = v_tenant_id
  WHERE q.quote_id  = p_quote_id
    AND q.tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_get_quote_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_get_quote_detail(uuid) TO authenticated;

-- ============================================================================
-- 2. quote_estimators table
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.quote_estimators (
  estimator_id uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  name         text        NOT NULL,
  initials     text,
  active       boolean     NOT NULL DEFAULT true,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_estimators_pkey PRIMARY KEY (estimator_id)
);

CREATE INDEX IF NOT EXISTS idx_qest_tenant ON app_data.quote_estimators (tenant_id, active, sort_order);

ALTER TABLE app_data.quote_estimators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qest_tenant_read ON app_data.quote_estimators;
CREATE POLICY qest_tenant_read ON app_data.quote_estimators
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

REVOKE ALL    ON app_data.quote_estimators FROM anon, authenticated;
GRANT  SELECT ON app_data.quote_estimators TO authenticated;
GRANT  ALL    ON app_data.quote_estimators TO service_role;

-- ============================================================================
-- 3. eq_list_estimators
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_estimators()
RETURNS TABLE (estimator_id uuid, name text, initials text, sort_order integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT e.estimator_id, e.name::text, e.initials::text, e.sort_order
  FROM app_data.quote_estimators e
  WHERE e.tenant_id = v_tenant_id AND e.active = true
  ORDER BY e.sort_order, e.name;
END;
$$;
REVOKE ALL ON FUNCTION public.eq_list_estimators() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_estimators() TO authenticated;

-- ============================================================================
-- 4. eq_upsert_estimator
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_upsert_estimator(
  p_estimator_id uuid DEFAULT NULL,
  p_name         text DEFAULT NULL,
  p_initials     text DEFAULT NULL,
  p_sort_order   integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_id        uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  IF p_estimator_id IS NOT NULL THEN
    UPDATE app_data.quote_estimators
    SET name = COALESCE(p_name, name),
        initials = COALESCE(p_initials, initials),
        sort_order = COALESCE(p_sort_order, sort_order)
    WHERE estimator_id = p_estimator_id AND tenant_id = v_tenant_id
    RETURNING estimator_id INTO v_id;
  ELSE
    INSERT INTO app_data.quote_estimators (tenant_id, name, initials, sort_order)
    VALUES (v_tenant_id, p_name, p_initials, COALESCE(p_sort_order, 0))
    RETURNING estimator_id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.eq_upsert_estimator(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_upsert_estimator(uuid, text, text, integer) TO authenticated;

-- ============================================================================
-- 5. eq_archive_estimator
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_archive_estimator(p_estimator_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  UPDATE app_data.quote_estimators
  SET active = false
  WHERE estimator_id = p_estimator_id AND tenant_id = v_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.eq_archive_estimator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_archive_estimator(uuid) TO authenticated;
