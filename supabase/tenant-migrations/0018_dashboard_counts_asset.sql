-- Migration: 0018_dashboard_counts_asset
-- Target:    Per-tenant data plane (eq-canonical-internal and any future tenant DBs)
-- Purpose:   Adds an `asset` count to the dashboard RPC so the Shell home screen
--            can show an Equipment KPI. Assets land in app_data.assets via
--            Intake (Service domain → eq_intake_commit_batch_service); this
--            surfaces them on the home dashboard so the data is reusable
--            anywhere, not siloed in one module.
--
-- Re-creates 0012_dashboard_counts_v2 verbatim plus one UNION ALL for 'asset'.

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
    -- EQ Quotes: quotes in canonical (populated via Intake sync or canonical-native quoting)
    UNION ALL SELECT 'quote',
      (SELECT count(*) FROM app_data.quote q, t WHERE q.tenant_id = t.tid)::bigint,
      (SELECT count(*) FROM app_data.quote q, t WHERE q.tenant_id = t.tid AND q.created_at > now() - interval '7 days')::bigint
    -- EQ Service: open incidents (status not closed/resolved)
    UNION ALL SELECT 'incident',
      (SELECT count(*) FROM app_data.incidents i, t WHERE i.tenant_id = t.tid AND i.status NOT IN ('closed', 'resolved'))::bigint,
      (SELECT count(*) FROM app_data.incidents i, t WHERE i.tenant_id = t.tid AND i.created_at > now() - interval '7 days')::bigint
    -- Plant & equipment: active assets in canonical (imported via Service intake)
    UNION ALL SELECT 'asset',
      (SELECT count(*) FROM app_data.assets a, t WHERE a.tenant_id = t.tid AND a.active = true)::bigint,
      (SELECT count(*) FROM app_data.assets a, t WHERE a.tenant_id = t.tid AND a.created_at > now() - interval '7 days')::bigint
    -- Cross-app canonical events: rolling 30-day window of app activity
    UNION ALL SELECT 'canonical_event',
      (SELECT count(*) FROM app_data.canonical_events e, t WHERE e.tenant_id = t.tid AND e.occurred_at > now() - interval '30 days')::bigint,
      (SELECT count(*) FROM app_data.canonical_events e, t WHERE e.tenant_id = t.tid AND e.occurred_at > now() - interval '7 days')::bigint
  )
  SELECT * FROM per_entity;
$$;

REVOKE ALL ON FUNCTION public.eq_tenant_dashboard_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_tenant_dashboard_counts(uuid) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0018_dashboard_counts_asset', NULL)
  ON CONFLICT (name) DO NOTHING;
