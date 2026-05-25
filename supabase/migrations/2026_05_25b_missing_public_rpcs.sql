-- Migration: 2026_05_25b_missing_public_rpcs
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Create public-schema wrappers for RPCs that TenantHome and
--            AdminAuditPage call via the PostgREST REST API.
--            PostgREST only exposes the `public` schema; functions that live
--            in shell_control are invisible to it. Two functions were missing
--            or in the wrong schema, causing 404/PGRST202 errors:
--              - eq_tenant_dashboard_counts (didn't exist anywhere)
--              - eq_recent_auth_events (existed in shell_control, not public)
--
-- Applied via MCP at 2026-05-25. This file is source-of-truth alignment;
-- re-running is idempotent (CREATE OR REPLACE).

-- 1. Dashboard counts — called by TenantHome with no params.
--    Reads tenant_id from the caller's JWT app_metadata so it is
--    automatically scoped to the right tenant without any parameter.
CREATE OR REPLACE FUNCTION public.eq_tenant_dashboard_counts()
RETURNS TABLE(entity text, count_total bigint, count_recent bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'shell_control', 'public'
AS $func$
  WITH t AS (
    SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid AS tid
  )
  SELECT
    'staff'::text,
    COUNT(*) FILTER (WHERE u.active = true),
    COUNT(*) FILTER (WHERE u.active = true AND u.created_at >= now() - interval '30 days')
  FROM shell_control.users u CROSS JOIN t
  WHERE u.tenant_id = t.tid
  UNION ALL
  SELECT 'site'::text, 0::bigint, 0::bigint
$func$;

REVOKE EXECUTE ON FUNCTION public.eq_tenant_dashboard_counts() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_tenant_dashboard_counts() TO authenticated, service_role;

-- 2. Auth events — public wrapper around the shell_control function.
--    AdminAuditPage calls this as sb.rpc('eq_recent_auth_events', { p_limit }).
CREATE OR REPLACE FUNCTION public.eq_recent_auth_events(p_limit integer DEFAULT 100)
RETURNS TABLE(id bigint, at timestamptz, event text, actor_id uuid, ip text, detail jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'shell_control', 'public'
AS $func$
  SELECT id, at, event, actor_id, ip, detail
  FROM shell_control.eq_recent_auth_events(p_limit)
$func$;

REVOKE EXECUTE ON FUNCTION public.eq_recent_auth_events(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_recent_auth_events(integer) TO authenticated, service_role;

-- Force PostgREST to pick up the new functions immediately.
NOTIFY pgrst, 'reload schema';
