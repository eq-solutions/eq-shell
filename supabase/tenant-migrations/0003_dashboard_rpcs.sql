-- Migration: 0003_dashboard_rpcs
-- Target:    Per-tenant data plane
-- Purpose:   Dashboard RPCs that the Shell calls. Bodies are identical to
--            the original on shared eq-canonical (still defined there for
--            now), except they take an explicit p_tenant_id parameter
--            instead of reading auth.jwt() — because the Netlify function
--            calling them uses the service-role key (which has no JWT).
--
--            Once browser-side code stops calling the shared versions, we
--            can DROP them from shared eq-canonical.

CREATE OR REPLACE FUNCTION public.eq_tenant_dashboard_counts(p_tenant_id uuid)
RETURNS TABLE(entity text, count_total bigint, count_recent bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $$
  WITH t AS (SELECT p_tenant_id AS tid),
  per_entity AS (
    SELECT 'customer'::text AS entity,
      (SELECT count(*) FROM app_data.customers c, t WHERE c.tenant_id = t.tid)::bigint AS total,
      (SELECT count(*) FROM app_data.customers c, t WHERE c.tenant_id = t.tid AND c.created_at > now() - interval '7 days')::bigint AS recent
    UNION ALL SELECT 'contact',
      (SELECT count(*) FROM app_data.contacts c, t WHERE c.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.contacts c, t WHERE c.tenant_id = t.tid AND c.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'site',
      (SELECT count(*) FROM app_data.sites s, t WHERE s.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.sites s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'staff',
      (SELECT count(*) FROM app_data.staff s, t WHERE s.tenant_id = t.tid AND s.active = true)::bigint,
      (SELECT count(*) FROM app_data.staff s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'schedule',
      (SELECT count(*) FROM app_data.schedule_entries s, t WHERE s.tenant_id = t.tid AND s.date >= current_date)::bigint,
      (SELECT count(*) FROM app_data.schedule_entries s, t WHERE s.tenant_id = t.tid AND s.date BETWEEN current_date AND current_date + 6)::bigint
    UNION ALL SELECT 'timesheet',
      (SELECT count(*) FROM app_data.timesheets s, t WHERE s.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.timesheets s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'leave_request',
      (SELECT count(*) FROM app_data.leave_requests s, t WHERE s.tenant_id = t.tid AND s.status = 'pending')::bigint,
      (SELECT count(*) FROM app_data.leave_requests s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'tender',
      (SELECT count(*) FROM app_data.tenders s, t WHERE s.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.tenders s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'prestart',
      (SELECT count(*) FROM app_data.prestart_checks s, t WHERE s.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.prestart_checks s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'toolbox_talk',
      (SELECT count(*) FROM app_data.toolbox_talks s, t WHERE s.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.toolbox_talks s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'licence',
      (SELECT count(*) FROM app_data.licences s, t WHERE s.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.licences s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    -- TODO: EQ Service has no work_orders table in any migration as of 2026-05-27.
    -- The service schema uses job_plans, test_records, defects, etc. — no work order entity yet.
    -- Uncomment and use the correct table name once EQ Service adds work orders.
    -- UNION ALL SELECT 'work_order',
    --   (SELECT count(*) FROM app_data.work_orders s, t WHERE s.tenant_id = t.tid)::bigint,
    --   (SELECT count(*) FROM app_data.work_orders s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    -- TODO: EQ Cards has no issued_cards table as of 2026-05-27.
    -- Cards stores worker credentials in public.licences and public.certificates (both in public schema, not app_data).
    -- Uncomment and correct schema/table once EQ Cards adds a tenant-scoped issued-card concept.
    -- UNION ALL SELECT 'card',
    --   (SELECT count(*) FROM app_data.issued_cards s, t WHERE s.tenant_id = t.tid)::bigint,
    --   (SELECT count(*) FROM app_data.issued_cards s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
  )
  SELECT * FROM per_entity;
$$;

REVOKE ALL ON FUNCTION public.eq_tenant_dashboard_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_tenant_dashboard_counts(uuid) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0003_dashboard_rpcs', NULL)
  ON CONFLICT (name) DO NOTHING;
