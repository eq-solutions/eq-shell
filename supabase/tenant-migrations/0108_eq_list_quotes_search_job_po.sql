-- Migration 0108
-- eq_list_quotes — extend search to cover workbench_job_no and po_number.

BEGIN;

-- DROP first: some planes may have a newer signature (e.g. with follow_up_at from 0115
-- applied out-of-band). Postgres rejects CREATE OR REPLACE when OUT param types differ.
DROP FUNCTION IF EXISTS public.eq_list_quotes(text, text);

CREATE OR REPLACE FUNCTION public.eq_list_quotes(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  quote_id         uuid,
  quote_number     text,
  status           text,
  project_name     text,
  estimator_name   text,
  estimator_initials text,
  subtotal_cents   bigint,
  gst_cents        bigint,
  total_cents      bigint,
  margin_pct       numeric,
  sent_at          timestamp with time zone,
  expires_at       timestamp with time zone,
  workbench_job_no text,
  po_number        text,
  created_at       timestamp with time zone,
  customer_name    text,
  site_name        text,
  site_code        text,
  line_item_count  bigint
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
    q.quote_id, q.quote_number::text, q.status::text, q.project_name::text,
    q.estimator_name::text, q.estimator_initials::text, q.subtotal_cents,
    q.gst_cents, q.total_cents, q.margin_pct, q.sent_at, q.expires_at,
    q.workbench_job_no::text, q.po_number::text, q.created_at,
    c.company_name::text, s.name::text, s.code::text,
    (SELECT count(*)::bigint FROM app_data.quote_line_item qli WHERE qli.quote_id = q.quote_id)
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s ON s.site_id     = q.site_id
  WHERE q.tenant_id = v_tenant_id
    AND q.deleted_at IS NULL
    AND (p_status IS NULL OR q.status = p_status)
    AND (p_search IS NULL OR (
          q.quote_number      ILIKE '%' || p_search || '%'
       OR q.project_name      ILIKE '%' || p_search || '%'
       OR c.company_name      ILIKE '%' || p_search || '%'
       OR q.workbench_job_no  ILIKE '%' || p_search || '%'
       OR q.po_number         ILIKE '%' || p_search || '%'
    ))
  ORDER BY q.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_quotes(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_quotes(text, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0108_eq_list_quotes_search_job_po', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
