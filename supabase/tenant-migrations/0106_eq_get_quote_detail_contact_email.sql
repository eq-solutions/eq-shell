-- Migration 0106
-- eq_get_quote_detail — add contact_email via LEFT JOIN to contacts table.
-- Also exposes contact_id so the UI can link/unlink contacts later.

BEGIN;

-- DROP required because return type changes (new columns added)
DROP FUNCTION IF EXISTS public.eq_get_quote_detail(uuid);

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
  contact_id          uuid,
  contact_email       text,
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
    q.notes::text             AS quote_notes,
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
    c.company_name::text      AS customer_name,
    s.name::text              AS site_name,
    s.code::text              AS site_code,
    q.contact_id,
    co.email::text            AS contact_email,
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
  LEFT JOIN app_data.customers c  ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s  ON s.site_id     = q.site_id
  LEFT JOIN app_data.contacts  co ON co.contact_id = q.contact_id
                                  AND co.tenant_id  = v_tenant_id
  WHERE q.quote_id  = p_quote_id
    AND q.tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_get_quote_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_get_quote_detail(uuid) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0106_eq_get_quote_detail_contact_email', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
