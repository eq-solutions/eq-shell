-- Migration: 0021_service_ppm_rpcs
-- Target:    Per-tenant data plane (every tenant Supabase project)
-- Purpose:   Codify the EQ Service PPM (planned-preventative-maintenance)
--            reporting RPCs that were applied OUT OF BAND to sks-canonical:
--              eq_ppm_asset_status, eq_ppm_open_defects, eq_ppm_overdue_assets,
--              eq_ppm_site_summary, eq_ppm_visit_completion_rate
--
-- Depends on 0020_service_cmms (service_visits, asset_test_results,
-- asset_defects, service_task_completions) + assets/sites from 0001/0002.
--
-- HARDENING vs the live SKS copies (which the security audit flagged):
--   * SET search_path pinned  — the live copies had a mutable search_path
--     (advisor: function_search_path_mutable) on a SECURITY DEFINER function.
--   * service_role-only EXECUTE — the live copies were executable by anon AND
--     authenticated (advisor: anon_security_definer_function_executable).
--     These are SECURITY DEFINER and take p_tenant_id as a PARAMETER, so an
--     authenticated caller could pass another tenant's id and read across
--     tenants. They are server-side reports (called through canonical-api with
--     a trusted tenant id), never from a browser — so they are locked to
--     service_role. If a browser dashboard ever needs them, expose them via a
--     canonical-api endpoint, not a direct grant.
--
-- Bodies are otherwise verbatim from sks-canonical (pg_get_functiondef).
--
-- NOTE: no live consumer as of 2026-05-30 — neither eq-solves-service nor the
-- Shell calls these. Codified (hardened) rather than dropped so the canonical
-- surface is reproducible; candidate for removal if a PPM dashboard never lands.
--
-- Idempotent (CREATE OR REPLACE) + forward-only.

BEGIN;

CREATE OR REPLACE FUNCTION app_data.eq_ppm_asset_status(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(asset_id uuid, external_id text, asset_name text, asset_type text, site_id uuid, location_in_site text, criticality text, condition text, ppm_frequency text, last_service_date date, next_service_due date, last_thermal_date date, last_thermal_pass boolean, last_rcd_date date, last_rcd_pass boolean, open_defect_count integer, critical_defect_count integer, compliance_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT a.asset_id, a.external_id::text, a.name::text, a.asset_type::text, a.site_id, a.location_in_site::text,
    a.criticality::text, a.condition::text, a.ppm_frequency::text, a.last_service_date, a.next_service_due,
    thermal.test_date, (thermal.pass_fail = 'pass'), rcd.test_date, (rcd.pass_fail = 'pass'),
    COALESCE(def.open_count,0)::INT, COALESCE(def.critical_count,0)::INT,
    CASE WHEN a.next_service_due IS NULL THEN 'unknown'
         WHEN a.next_service_due < CURRENT_DATE THEN 'overdue'
         WHEN a.next_service_due <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
         ELSE 'current' END
  FROM app_data.assets a
  LEFT JOIN LATERAL (SELECT atr.test_date, atr.pass_fail FROM app_data.asset_test_results atr
    WHERE atr.tenant_id=p_tenant_id AND atr.asset_id=a.asset_id AND atr.test_type LIKE '%thermal%'
    ORDER BY atr.test_date DESC LIMIT 1) thermal ON true
  LEFT JOIN LATERAL (SELECT atr.test_date, atr.pass_fail FROM app_data.asset_test_results atr
    WHERE atr.tenant_id=p_tenant_id AND atr.asset_id=a.asset_id AND atr.test_type LIKE '%rcd%'
    ORDER BY atr.test_date DESC LIMIT 1) rcd ON true
  LEFT JOIN LATERAL (SELECT COUNT(*) AS open_count, COUNT(*) FILTER (WHERE ad.severity='critical') AS critical_count
    FROM app_data.asset_defects ad WHERE ad.tenant_id=p_tenant_id AND ad.asset_id=a.asset_id
      AND ad.status NOT IN ('resolved','no_action')) def ON true
  WHERE a.tenant_id=p_tenant_id AND (p_site_id IS NULL OR a.site_id=p_site_id)
  ORDER BY CASE a.criticality WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, a.asset_type, a.external_id;
END; $function$;

CREATE OR REPLACE FUNCTION app_data.eq_ppm_open_defects(p_tenant_id uuid, p_severity text DEFAULT NULL::text)
 RETURNS TABLE(defect_id uuid, asset_name text, asset_type text, site_name text, severity text, status text, description text, raised_date date, age_days integer, estimated_cost numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT d.defect_id, a.name::text, a.asset_type::text, s.name::text, d.severity::text, d.status::text, d.description::text,
    d.raised_date, (CURRENT_DATE - d.raised_date)::INT, d.estimated_cost
  FROM app_data.asset_defects d
  LEFT JOIN app_data.assets a ON a.asset_id=d.asset_id AND a.tenant_id=p_tenant_id
  LEFT JOIN app_data.sites s ON s.site_id=a.site_id AND s.tenant_id=p_tenant_id
  WHERE d.tenant_id=p_tenant_id AND d.status NOT IN ('resolved','no_action') AND (p_severity IS NULL OR d.severity=p_severity)
  ORDER BY CASE d.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, d.raised_date;
END; $function$;

CREATE OR REPLACE FUNCTION app_data.eq_ppm_overdue_assets(p_tenant_id uuid, p_days_overdue integer DEFAULT 0)
 RETURNS TABLE(asset_id uuid, external_id text, asset_name text, asset_type text, site_name text, location_in_site text, criticality text, last_service_date date, next_service_due date, days_overdue integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT a.asset_id, a.external_id::text, a.name::text, a.asset_type::text, s.name::text, a.location_in_site::text,
    a.criticality::text, a.last_service_date, a.next_service_due, (CURRENT_DATE - a.next_service_due)::INT
  FROM app_data.assets a
  LEFT JOIN app_data.sites s ON s.site_id=a.site_id AND s.tenant_id=p_tenant_id
  WHERE a.tenant_id=p_tenant_id AND a.next_service_due IS NOT NULL
    AND a.next_service_due <= CURRENT_DATE + (p_days_overdue || ' days')::INTERVAL
  ORDER BY CASE a.criticality WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.next_service_due;
END; $function$;

CREATE OR REPLACE FUNCTION app_data.eq_ppm_site_summary(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(site_id uuid, site_name text, asset_count integer, compliant_count integer, due_soon_count integer, overdue_count integer, unknown_count integer, open_defects integer, open_critical_defects integer, compliance_pct numeric, next_visit_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT s.site_id, s.name::text, COUNT(a.asset_id)::INT,
    COUNT(a.asset_id) FILTER (WHERE a.next_service_due IS NOT NULL AND a.next_service_due >= CURRENT_DATE + INTERVAL '30 days')::INT,
    COUNT(a.asset_id) FILTER (WHERE a.next_service_due IS NOT NULL AND a.next_service_due >= CURRENT_DATE AND a.next_service_due < CURRENT_DATE + INTERVAL '30 days')::INT,
    COUNT(a.asset_id) FILTER (WHERE a.next_service_due IS NOT NULL AND a.next_service_due < CURRENT_DATE)::INT,
    COUNT(a.asset_id) FILTER (WHERE a.next_service_due IS NULL)::INT,
    COALESCE(SUM(def.open_count),0)::INT, COALESCE(SUM(def.critical_count),0)::INT,
    CASE WHEN COUNT(a.asset_id)=0 THEN 0 ELSE ROUND(100.0 * COUNT(a.asset_id) FILTER (WHERE a.next_service_due IS NOT NULL AND a.next_service_due >= CURRENT_DATE) / COUNT(a.asset_id), 1) END,
    (SELECT MIN(sv.scheduled_date) FROM app_data.service_visits sv WHERE sv.tenant_id=p_tenant_id AND sv.site_id=s.site_id AND sv.status='planned' AND sv.scheduled_date >= CURRENT_DATE)
  FROM app_data.sites s
  LEFT JOIN app_data.assets a ON a.site_id=s.site_id AND a.tenant_id=p_tenant_id
  LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE ad.status NOT IN ('resolved','no_action')) AS open_count,
      COUNT(*) FILTER (WHERE ad.status NOT IN ('resolved','no_action') AND ad.severity='critical') AS critical_count
    FROM app_data.asset_defects ad WHERE ad.tenant_id=p_tenant_id AND ad.asset_id=a.asset_id) def ON true
  WHERE s.tenant_id=p_tenant_id AND (p_site_id IS NULL OR s.site_id=p_site_id)
  GROUP BY s.site_id, s.name
  ORDER BY open_critical_defects DESC, overdue_count DESC, s.name;
END; $function$;

CREATE OR REPLACE FUNCTION app_data.eq_ppm_visit_completion_rate(p_tenant_id uuid, p_from_date date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(visit_id uuid, site_name text, scheduled_date date, status text, client_job_code text, expected_assets integer, tasks_total integer, tasks_completed integer, completion_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT v.visit_id, s.name::text, v.scheduled_date, v.status::text, v.client_job_code::text, v.expected_assets,
    COUNT(tc.completion_id)::INT, COUNT(tc.completion_id) FILTER (WHERE tc.completed=true)::INT,
    CASE WHEN COUNT(tc.completion_id)=0 THEN 0 ELSE ROUND(100.0 * COUNT(tc.completion_id) FILTER (WHERE tc.completed=true) / COUNT(tc.completion_id), 1) END
  FROM app_data.service_visits v
  LEFT JOIN app_data.sites s ON s.site_id=v.site_id AND s.tenant_id=p_tenant_id
  LEFT JOIN app_data.service_task_completions tc ON tc.visit_id=v.visit_id AND tc.tenant_id=p_tenant_id
  WHERE v.tenant_id=p_tenant_id AND v.scheduled_date BETWEEN p_from_date AND p_to_date
  GROUP BY v.visit_id, s.name, v.scheduled_date, v.status, v.client_job_code, v.expected_assets
  ORDER BY v.scheduled_date DESC;
END; $function$;

-- ── Hardening: lock all five to service_role only, pinned search_path above ──

REVOKE ALL ON FUNCTION app_data.eq_ppm_asset_status(uuid, uuid)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_data.eq_ppm_open_defects(uuid, text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_data.eq_ppm_overdue_assets(uuid, integer)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_data.eq_ppm_site_summary(uuid, uuid)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_data.eq_ppm_visit_completion_rate(uuid, date, date)  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app_data.eq_ppm_asset_status(uuid, uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION app_data.eq_ppm_open_defects(uuid, text)               TO service_role;
GRANT EXECUTE ON FUNCTION app_data.eq_ppm_overdue_assets(uuid, integer)          TO service_role;
GRANT EXECUTE ON FUNCTION app_data.eq_ppm_site_summary(uuid, uuid)               TO service_role;
GRANT EXECUTE ON FUNCTION app_data.eq_ppm_visit_completion_rate(uuid, date, date) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0021_service_ppm_rpcs', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
