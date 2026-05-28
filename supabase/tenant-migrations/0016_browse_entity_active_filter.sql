-- Migration: 0016_browse_entity_active_filter
-- Target:    Per-tenant data plane
-- Purpose:   Adds p_active boolean filter to eq_browse_entity.
--
--            Entities that have an `active` column:
--              customer (customers), contact (contacts), site (sites),
--              staff (staff), licence (licences), asset (assets)
--
--            For all other entities the filter is silently ignored (the
--            WHERE clause short-circuits on p_entity NOT IN the list).
--            This keeps the RPC generic — callers never need to check
--            whether the entity supports active filtering.

DROP FUNCTION IF EXISTS public.eq_browse_entity(text, uuid, integer, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.eq_browse_entity(
  p_entity    text,
  p_tenant_id uuid,
  p_limit     integer DEFAULT 50,
  p_offset    integer DEFAULT 0,
  p_search    text    DEFAULT NULL,
  p_sort_col  text    DEFAULT 'created_at',
  p_sort_dir  text    DEFAULT 'DESC',
  p_active    boolean DEFAULT NULL
)
RETURNS TABLE(row_json jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_table        text;
  v_total        bigint;
  v_dir          text;
  v_search       text;
  v_col          text;
  v_has_active   boolean;
  v_active_clause text;
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

  v_dir := CASE UPPER(COALESCE(p_sort_dir, 'DESC'))
    WHEN 'ASC' THEN 'ASC'
    ELSE 'DESC'
  END;

  v_col := COALESCE(NULLIF(trim(p_sort_col), ''), 'created_at');

  v_search := CASE
    WHEN p_search IS NOT NULL AND trim(p_search) <> ''
      THEN '%' || trim(p_search) || '%'
    ELSE NULL
  END;

  -- Entities that support active filtering.
  v_has_active := p_entity IN ('customer', 'contact', 'site', 'staff', 'licence', 'asset');
  v_active_clause := CASE
    WHEN p_active IS NULL OR NOT v_has_active THEN ''
    WHEN p_active THEN ' AND t.active = TRUE'
    ELSE ' AND t.active = FALSE'
  END;

  -- Count (respects search + active filter).
  EXECUTE format(
    'SELECT count(*) FROM app_data.%I t WHERE t.tenant_id = $1'
    || CASE WHEN v_search IS NOT NULL THEN ' AND to_jsonb(t.*)::text ILIKE $2' ELSE '' END
    || v_active_clause,
    v_table
  ) INTO v_total USING p_tenant_id, v_search;

  -- Paged rows.
  RETURN QUERY EXECUTE format(
    'SELECT to_jsonb(t.*) AS row_json, $1::bigint AS total_count
     FROM app_data.%I t
     WHERE t.tenant_id = $2'
    || CASE WHEN v_search IS NOT NULL THEN ' AND to_jsonb(t.*)::text ILIKE $3' ELSE '' END
    || v_active_clause
    || ' ORDER BY t.%I %s NULLS LAST'
    || ' LIMIT $4 OFFSET $5',
    v_table, v_col, v_dir
  ) USING v_total, p_tenant_id, v_search, p_limit, p_offset;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_browse_entity(text, uuid, integer, integer, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_browse_entity(text, uuid, integer, integer, text, text, text, boolean)
  TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0016_browse_entity_active_filter', NULL)
  ON CONFLICT (name) DO NOTHING;
