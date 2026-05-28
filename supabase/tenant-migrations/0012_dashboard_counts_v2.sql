-- Migration: 0012_dashboard_counts_v2
-- Target:    Per-tenant data plane (eq-canonical-internal and any future tenant DBs)
-- Purpose:   Adds quote, incident, and canonical_event counts to the dashboard
--            RPC so the Shell sidebar can show badges for Quotes, Service, and Cards.
--
-- Entity → Shell app mapping:
--   staff           → EQ Field  (active staff)
--   incident        → EQ Service (open incidents not yet resolved/closed)
--   quote           → EQ Quotes  (all quotes; populated via Intake sync)
--   licence         → EQ Cards   (staff licences; proxy until issued-card entity exists)
--   canonical_event → cross-app  (events written by any app via eq_write_canonical_event)

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
    -- Cross-app canonical events: rolling 30-day window of app activity
    UNION ALL SELECT 'canonical_event',
      (SELECT count(*) FROM app_data.canonical_events e, t WHERE e.tenant_id = t.tid AND e.occurred_at > now() - interval '30 days')::bigint,
      (SELECT count(*) FROM app_data.canonical_events e, t WHERE e.tenant_id = t.tid AND e.occurred_at > now() - interval '7 days')::bigint
  )
  SELECT * FROM per_entity;
$$;

REVOKE ALL ON FUNCTION public.eq_tenant_dashboard_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_tenant_dashboard_counts(uuid) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0012_dashboard_counts_v2', NULL)
  ON CONFLICT (name) DO NOTHING;
