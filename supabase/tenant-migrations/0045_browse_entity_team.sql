-- Migration: 0045_browse_entity_team
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Register the `team` entity in the eq_browse_entity() RPC so that
--            teams can be browsed from the EQ Shell Records section.
--
-- app_data.teams schema (live-verified 2026-06-08):
--   id uuid NOT NULL PK, tenant_id uuid NOT NULL,
--   nspbmir_id bigint, name text NOT NULL, color text,
--   created_at timestamptz NOT NULL
--
-- No `active` column → p_active filter is a no-op for team (v_has_active excludes it).
-- Idempotent CREATE OR REPLACE; grants preserved.

CREATE OR REPLACE FUNCTION public.eq_browse_entity(p_entity text, p_tenant_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_sort_col text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'DESC'::text, p_active boolean DEFAULT NULL::boolean)
 RETURNS TABLE(row_json jsonb, total_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
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
  v_entity_clause text;
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
    WHEN 'team'          THEN 'teams'
    ELSE NULL
  END;

  IF v_table IS NULL THEN
    RAISE EXCEPTION 'unknown entity: %', p_entity;
  END IF;

  v_dir := CASE UPPER(COALESCE(p_sort_dir, 'DESC')) WHEN 'ASC' THEN 'ASC' ELSE 'DESC' END;
  v_col := COALESCE(NULLIF(trim(p_sort_col), ''), 'created_at');
  v_search := CASE WHEN p_search IS NOT NULL AND trim(p_search) <> '' THEN '%' || trim(p_search) || '%' ELSE NULL END;

  -- `teams` has no `active` column; only CRM/resource entities support the active filter.
  v_has_active := p_entity IN ('customer', 'contact', 'site', 'staff', 'licence', 'asset');
  v_active_clause := CASE
    WHEN p_active IS NULL OR NOT v_has_active THEN ''
    WHEN p_active THEN ' AND t.active = TRUE'
    ELSE ' AND t.active = FALSE'
  END;

  -- Scope asset browse to plant & equipment (matches Plant & Equipment page).
  v_entity_clause := CASE WHEN p_entity = 'asset' THEN ' AND t.asset_type = ''plant_equipment''' ELSE '' END;

  EXECUTE format(
    'SELECT count(*) FROM app_data.%I t WHERE t.tenant_id = $1'
    || CASE WHEN v_search IS NOT NULL THEN ' AND to_jsonb(t.*)::text ILIKE $2' ELSE '' END
    || v_active_clause
    || v_entity_clause,
    v_table
  ) INTO v_total USING p_tenant_id, v_search;

  RETURN QUERY EXECUTE format(
    'SELECT to_jsonb(t.*) AS row_json, $1::bigint AS total_count
     FROM app_data.%I t
     WHERE t.tenant_id = $2'
    || CASE WHEN v_search IS NOT NULL THEN ' AND to_jsonb(t.*)::text ILIKE $3' ELSE '' END
    || v_active_clause
    || v_entity_clause
    || ' ORDER BY t.%I %s NULLS LAST'
    || ' LIMIT $4 OFFSET $5',
    v_table, v_col, v_dir
  ) USING v_total, p_tenant_id, v_search, p_limit, p_offset;
END
$function$;
