-- Migration: 0014_browse_entity_search
-- Target:    Per-tenant data plane
-- Purpose:   Adds server-side search (ILIKE across row JSON), sort column,
--            and sort direction to eq_browse_entity.
--
--            Replaces the old 4-param signature. Because PostgreSQL treats
--            different parameter lists as distinct overloads, we DROP the old
--            function before creating the new one so PostgREST resolves
--            correctly. The Netlify function still works — new params all have
--            defaults so existing callers that only pass 4 params continue
--            to function without any changes.

DROP FUNCTION IF EXISTS public.eq_browse_entity(text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.eq_browse_entity(
  p_entity    text,
  p_tenant_id uuid,
  p_limit     integer DEFAULT 50,
  p_offset    integer DEFAULT 0,
  p_search    text    DEFAULT NULL,
  p_sort_col  text    DEFAULT 'created_at',
  p_sort_dir  text    DEFAULT 'DESC'
)
RETURNS TABLE(row_json jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_table  text;
  v_total  bigint;
  v_dir    text;
  v_search text;
  v_col    text;
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

  -- Only allow ASC or DESC — prevents injection via the format string.
  v_dir := CASE UPPER(COALESCE(p_sort_dir, 'DESC'))
    WHEN 'ASC' THEN 'ASC'
    ELSE 'DESC'
  END;

  -- Fall back to created_at if no sort column supplied.
  v_col := COALESCE(NULLIF(trim(p_sort_col), ''), 'created_at');

  -- Wrap search term for ILIKE. NULL / blank = no filter.
  v_search := CASE
    WHEN p_search IS NOT NULL AND trim(p_search) <> ''
      THEN '%' || trim(p_search) || '%'
    ELSE NULL
  END;

  -- Count (respects search filter).
  IF v_search IS NOT NULL THEN
    EXECUTE format(
      'SELECT count(*) FROM app_data.%I t WHERE t.tenant_id = $1
       AND to_jsonb(t.*)::text ILIKE $2',
      v_table
    ) INTO v_total USING p_tenant_id, v_search;
  ELSE
    EXECUTE format(
      'SELECT count(*) FROM app_data.%I t WHERE t.tenant_id = $1',
      v_table
    ) INTO v_total USING p_tenant_id;
  END IF;

  -- Paged rows (sort column is quoted with %I to prevent injection).
  IF v_search IS NOT NULL THEN
    RETURN QUERY EXECUTE format(
      'SELECT to_jsonb(t.*) AS row_json, $1::bigint AS total_count
       FROM app_data.%I t
       WHERE t.tenant_id = $2 AND to_jsonb(t.*)::text ILIKE $3
       ORDER BY t.%I %s NULLS LAST
       LIMIT $4 OFFSET $5',
      v_table, v_col, v_dir
    ) USING v_total, p_tenant_id, v_search, p_limit, p_offset;
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT to_jsonb(t.*) AS row_json, $1::bigint AS total_count
       FROM app_data.%I t
       WHERE t.tenant_id = $2
       ORDER BY t.%I %s NULLS LAST
       LIMIT $3 OFFSET $4',
      v_table, v_col, v_dir
    ) USING v_total, p_tenant_id, p_limit, p_offset;
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_browse_entity(text, uuid, integer, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_browse_entity(text, uuid, integer, integer, text, text, text)
  TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0014_browse_entity_search', NULL)
  ON CONFLICT (name) DO NOTHING;
