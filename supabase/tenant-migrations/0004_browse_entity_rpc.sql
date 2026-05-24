-- Migration: 0004_browse_entity_rpc
-- Target:    Per-tenant data plane
-- Purpose:   eq_browse_entity RPC — generic entity row lookup used by the
--            Shell's EntityBrowserPage.
--
--            Body mirrors the original on shared eq-canonical, except it
--            takes tenant_id as an explicit parameter (service-role
--            callers don't have a JWT to read).
--
--            Once browser-side EntityBrowserPage stops calling the shared
--            version, we can DROP the shared one.

CREATE OR REPLACE FUNCTION public.eq_browse_entity(
  p_entity    text,
  p_tenant_id uuid,
  p_limit     integer DEFAULT 50,
  p_offset    integer DEFAULT 0
)
RETURNS TABLE(row_json jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_table text;
  v_total bigint;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  v_table := CASE p_entity
    WHEN 'customer'      THEN 'customers'
    WHEN 'contact'       THEN 'contacts'
    WHEN 'site'          THEN 'sites'
    WHEN 'staff'         THEN 'staff'
    WHEN 'schedule'      THEN 'schedule_entries'
    WHEN 'timesheet'     THEN 'timesheets'
    WHEN 'leave_request' THEN 'leave_requests'
    WHEN 'tender'        THEN 'tenders'
    WHEN 'prestart'      THEN 'prestart_checks'
    WHEN 'toolbox_talk'  THEN 'toolbox_talks'
    WHEN 'licence'       THEN 'licences'
    WHEN 'asset'         THEN 'assets'
    ELSE NULL
  END;

  IF v_table IS NULL THEN
    RAISE EXCEPTION 'unknown entity: %', p_entity;
  END IF;

  EXECUTE format('SELECT count(*) FROM app_data.%I WHERE tenant_id = $1', v_table)
    INTO v_total USING p_tenant_id;

  RETURN QUERY EXECUTE format(
    'SELECT to_jsonb(t.*) AS row_json, $1::bigint AS total_count
     FROM app_data.%I t WHERE t.tenant_id = $2
     ORDER BY t.created_at DESC NULLS LAST
     LIMIT $3 OFFSET $4',
    v_table
  ) USING v_total, p_tenant_id, p_limit, p_offset;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_browse_entity(text, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_browse_entity(text, uuid, integer, integer) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0004_browse_entity_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
