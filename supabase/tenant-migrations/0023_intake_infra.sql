-- 0023_intake_infra.sql
-- Tenant-plane intake guard/log layer: per-tenant API rate-limiting + call audit
-- for the canonical-api external-intake path.
--
-- Plane split (locked 2026-05-30 — ARCHITECTURE-V2 "Source of truth model"):
--   * Intake EVENT LIFECYCLE + module CATALOG stay on the CONTROL plane (jvkn):
--     shell_control.eq_intake_events / eq_intake_templates / eq_schema_registry,
--     driven by the intake-commit orchestrator ("audit-on-shared / data-on-tenant",
--     netlify/functions/intake-commit.ts). They are NOT replicated per tenant —
--     the tenant commit RPCs (0005-0011) are app_data-only and need nothing here.
--   * This migration adds only the genuinely TENANT-plane pieces EQ is missing:
--     the rate-limit + API-call-log tables and their functions.
--
-- Faithful to the live SKS objects, with two corrections:
--   1. search_path pinned on every SECURITY DEFINER function (the SKS copies are
--      mutable — a privilege-escalation foothold on a definer function).
--   2. RLS reads app_metadata.tenant_id, not user_metadata (Phase 1.F canonical).
--
-- NOT ported: eq_get_intake_health. It aggregates the intake event log, which
-- lives in shell_control on the control plane; its tenant-plane copy references a
-- non-existent app_data.intake_events and is dead. Its correct home is jvkn —
-- tracked as a control-plane intake-surface fix, not a tenant port.
--
-- Idempotent + transactional. EQ (proving ground) first; SKS hardening batched.

BEGIN;

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.eq_intake_rate_limits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eq_intake_rate_limits_tenant_time_idx
  ON app_data.eq_intake_rate_limits (tenant_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS app_data.api_intake_calls (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL,
  called_at       timestamptz NOT NULL DEFAULT now(),
  caller_user_id  uuid,
  caller_source   text,
  entity          text        NOT NULL,
  row_count_in    integer     NOT NULL DEFAULT 0,
  dry_run         boolean     NOT NULL DEFAULT false,
  http_status     integer,
  committed_count integer     NOT NULL DEFAULT 0,
  rejected_count  integer     NOT NULL DEFAULT 0,
  flagged_count   integer     NOT NULL DEFAULT 0,
  error_message   text,
  intake_event_id uuid,
  duration_ms     integer
);

CREATE INDEX IF NOT EXISTS api_intake_calls_tenant_time_idx
  ON app_data.api_intake_calls (tenant_id, called_at DESC);
CREATE INDEX IF NOT EXISTS api_intake_calls_source_idx
  ON app_data.api_intake_calls (tenant_id, caller_source, called_at DESC);

-- ── RLS (app_metadata tenant isolation — corrected from SKS's user_metadata) ──

ALTER TABLE app_data.eq_intake_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.api_intake_calls      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON app_data.eq_intake_rate_limits;
CREATE POLICY tenant_isolation ON app_data.eq_intake_rate_limits
  FOR ALL
  USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON app_data.api_intake_calls;
CREATE POLICY tenant_isolation ON app_data.api_intake_calls
  FOR ALL
  USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid);

-- ── Table grants: service_role only (the intake path is server-side) ────────

REVOKE ALL ON app_data.eq_intake_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON app_data.api_intake_calls      FROM PUBLIC, anon, authenticated;
GRANT  ALL ON app_data.eq_intake_rate_limits TO service_role;
GRANT  ALL ON app_data.api_intake_calls      TO service_role;

-- ── Functions (faithful to SKS; search_path pinned) ─────────────────────────

CREATE OR REPLACE FUNCTION app_data.eq_check_intake_rate_limit(
  p_tenant_id uuid, p_window_minutes integer DEFAULT 60, p_max_calls integer DEFAULT 50)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'app_data', 'public'
AS $function$
DECLARE
  v_window_start timestamptz;
  v_call_count   int;
BEGIN
  v_window_start := now() - (p_window_minutes || ' minutes')::interval;

  SELECT count(*) INTO v_call_count
    FROM app_data.eq_intake_rate_limits
   WHERE tenant_id = p_tenant_id
     AND recorded_at >= v_window_start;

  -- Prune rows older than 2x the window to keep the table lean.
  DELETE FROM app_data.eq_intake_rate_limits
   WHERE tenant_id = p_tenant_id
     AND recorded_at < now() - ((p_window_minutes * 2) || ' minutes')::interval;

  RETURN v_call_count < p_max_calls;
END;
$function$;

CREATE OR REPLACE FUNCTION app_data.eq_increment_intake_rate_limit(p_tenant_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'app_data', 'public'
AS $function$
BEGIN
  INSERT INTO app_data.eq_intake_rate_limits (tenant_id, recorded_at)
  VALUES (p_tenant_id, now());
END;
$function$;

CREATE OR REPLACE FUNCTION app_data.eq_record_api_intake_call(
  p_tenant_id uuid, p_caller_user_id uuid DEFAULT NULL::uuid,
  p_caller_source text DEFAULT 'api'::text, p_entity text DEFAULT ''::text,
  p_row_count_in integer DEFAULT 0, p_dry_run boolean DEFAULT false,
  p_http_status integer DEFAULT 200, p_committed_count integer DEFAULT 0,
  p_rejected_count integer DEFAULT 0, p_flagged_count integer DEFAULT 0,
  p_error_message text DEFAULT NULL::text, p_intake_event_id uuid DEFAULT NULL::uuid,
  p_duration_ms integer DEFAULT NULL::integer)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'app_data', 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO app_data.api_intake_calls (
    tenant_id, caller_user_id, caller_source, entity, row_count_in, dry_run,
    http_status, committed_count, rejected_count, flagged_count,
    error_message, intake_event_id, duration_ms
  )
  VALUES (
    p_tenant_id, p_caller_user_id, p_caller_source, p_entity, p_row_count_in, p_dry_run,
    p_http_status, p_committed_count, p_rejected_count, p_flagged_count,
    p_error_message, p_intake_event_id, p_duration_ms
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_data.eq_get_api_call_log(
  p_tenant_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
  RETURNS TABLE(id uuid, called_at timestamptz, caller_source text, entity text,
                row_count_in integer, dry_run boolean, http_status integer,
                committed_count integer, rejected_count integer,
                error_message text, duration_ms integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'app_data', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.id, c.called_at, c.caller_source, c.entity, c.row_count_in, c.dry_run,
         c.http_status, c.committed_count, c.rejected_count, c.error_message, c.duration_ms
  FROM app_data.api_intake_calls c
  WHERE c.tenant_id = p_tenant_id
  ORDER BY c.called_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- ── Function grants: service_role only (params carry a trusted tenant_id) ────

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_data'
      AND p.proname IN ('eq_check_intake_rate_limit','eq_increment_intake_rate_limit',
                        'eq_record_api_intake_call','eq_get_api_call_log')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', r.sig);
  END LOOP;
END $$;

COMMIT;
