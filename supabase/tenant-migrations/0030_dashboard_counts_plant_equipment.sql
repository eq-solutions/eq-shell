-- Migration: 0030_dashboard_counts_plant_equipment
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Scope the dashboard "Equipment" KPI to plant & equipment only.
--
-- app_data.assets is shared: EQ Service's CMMS writes thousands of asset rows
-- (asset_type 'General' + electrical types, imported_from='eq-solves-service'),
-- while the Plant & Equipment register uses asset_type='plant_equipment' (the
-- same filter the equipment module's equipment-list function applies). The
-- dashboard count RPC counted ALL active assets, so "Equipment" read e.g. 4808
-- instead of 39 for SKS.
--
-- Fix: filter both the `asset` count and the `asset_service_due` count to
-- asset_type='plant_equipment' so the Equipment card matches the Plant &
-- Equipment page. Idempotent CREATE OR REPLACE; grants are preserved.

CREATE OR REPLACE FUNCTION public.eq_tenant_dashboard_counts(p_tenant_id uuid)
 RETURNS TABLE(entity text, count_total bigint, count_recent bigint)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
  WITH t AS (SELECT p_tenant_id AS tid), per_entity AS (
    SELECT 'customer'::text AS entity, (SELECT count(*) FROM app_data.customers c, t WHERE c.tenant_id = t.tid)::bigint AS total, (SELECT count(*) FROM app_data.customers c, t WHERE c.tenant_id = t.tid AND c.created_at > now() - interval '7 days')::bigint AS recent
    UNION ALL SELECT 'contact', (SELECT count(*) FROM app_data.contacts c, t WHERE c.tenant_id = t.tid)::bigint, (SELECT count(*) FROM app_data.contacts c, t WHERE c.tenant_id = t.tid AND c.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'site', (SELECT count(*) FROM app_data.sites s, t WHERE s.tenant_id = t.tid)::bigint, (SELECT count(*) FROM app_data.sites s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'staff', (SELECT count(*) FROM app_data.staff s, t WHERE s.tenant_id = t.tid AND s.active = true)::bigint, (SELECT count(*) FROM app_data.staff s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'licence', (SELECT count(*) FROM app_data.licences s, t WHERE s.tenant_id = t.tid)::bigint, (SELECT count(*) FROM app_data.licences s, t WHERE s.tenant_id = t.tid AND s.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'quote', (SELECT count(*) FROM app_data.quote q, t WHERE q.tenant_id = t.tid)::bigint, (SELECT count(*) FROM app_data.quote q, t WHERE q.tenant_id = t.tid AND q.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'incident', (SELECT count(*) FROM app_data.incidents i, t WHERE i.tenant_id = t.tid AND i.status NOT IN ('closed', 'resolved'))::bigint, (SELECT count(*) FROM app_data.incidents i, t WHERE i.tenant_id = t.tid AND i.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'asset', (SELECT count(*) FROM app_data.assets a, t WHERE a.tenant_id = t.tid AND a.active = true AND a.asset_type = 'plant_equipment')::bigint, (SELECT count(*) FROM app_data.assets a, t WHERE a.tenant_id = t.tid AND a.asset_type = 'plant_equipment' AND a.created_at > now() - interval '7 days')::bigint
    UNION ALL SELECT 'asset_service_due', (SELECT count(*) FROM app_data.assets a, t WHERE a.tenant_id = t.tid AND a.active = true AND a.asset_type = 'plant_equipment' AND a.next_service_due IS NOT NULL AND a.next_service_due <= current_date + 30)::bigint, (SELECT count(*) FROM app_data.assets a, t WHERE a.tenant_id = t.tid AND a.active = true AND a.asset_type = 'plant_equipment' AND a.next_service_due IS NOT NULL AND a.next_service_due < current_date)::bigint
    UNION ALL SELECT 'canonical_event', (SELECT count(*) FROM app_data.canonical_events e, t WHERE e.tenant_id = t.tid AND e.occurred_at > now() - interval '30 days')::bigint, (SELECT count(*) FROM app_data.canonical_events e, t WHERE e.tenant_id = t.tid AND e.occurred_at > now() - interval '7 days')::bigint
  ) SELECT * FROM per_entity;
$function$;
