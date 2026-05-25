-- Migration: 2026_05_25f_dashboard_counts_site_comment
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Replace eq_tenant_dashboard_counts with an identical function
--            that documents why site count is 0: sites live in per-tenant
--            Supabase projects (shell_control has no sites/locations table).
--
-- No behavioural change. Idempotent (CREATE OR REPLACE).
-- Applied via MCP at 2026-05-25.

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
  -- Site count is 0: sites/locations live in each tenant's own Supabase project,
  -- not in shell_control. Wire this up once a sites view is exposed here.
  SELECT 'site'::text, 0::bigint, 0::bigint
$func$;

REVOKE EXECUTE ON FUNCTION public.eq_tenant_dashboard_counts() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_tenant_dashboard_counts() TO authenticated, service_role;
