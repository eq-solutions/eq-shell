-- 0029_safety_rpcs.sql
-- Prestart check + toolbox talk submit/approve RPCs with JWT tenant guard.
--
-- WHY: app_data.prestart_checks and app_data.toolbox_talks are part of the
-- core Field safety surface. Workers submit a record (draft → submitted);
-- supervisors/managers approve it (submitted → approved). These RPCs enforce
-- the state machine and scope writes to the caller's own tenant via JWT —
-- the tenant is derived from auth.jwt() → app_metadata.tenant_id, not from
-- the caller-supplied p_tenant_id. A caller can only act within their tenant.
--
-- sks-canonical received these RPCs during early ad-hoc development with a
-- weaker tenant check (trusted the caller-supplied param for anon callers).
-- That pattern was patched on 2026-06-02 via sks_safety_rpc_jwt_tenant_guard.
-- This migration canonicalises the safe version so every new tenant gets it
-- from the runner.
--
-- Pattern: SECURITY DEFINER, search_path pinned, v_tenant always from JWT.
-- NULL JWT tenant (anon / non-JWT service-role) is rejected — all legitimate
-- callers are authenticated Field users. service_role reaches the underlying
-- tables directly via table grants; it does not need EXECUTE on these RPCs.
--
-- Idempotent: CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION app_data.submit_safety_record(
  p_tenant_id  uuid,
  p_record_id  uuid,
  p_table_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'extensions'
AS $fn$
DECLARE
  v_tenant uuid := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
BEGIN
  IF v_tenant IS NULL OR (p_tenant_id IS NOT NULL AND p_tenant_id <> v_tenant) THEN
    RAISE EXCEPTION 'tenant mismatch' USING errcode = 'EQ010';
  END IF;

  IF p_table_name = 'prestart_checks' THEN
    UPDATE app_data.prestart_checks
       SET status = 'submitted'
     WHERE prestart_id = p_record_id
       AND tenant_id   = v_tenant
       AND status      = 'draft';

  ELSIF p_table_name = 'toolbox_talks' THEN
    UPDATE app_data.toolbox_talks
       SET status = 'submitted'
     WHERE talk_id   = p_record_id
       AND tenant_id = v_tenant
       AND status    = 'draft';

  ELSE
    RAISE EXCEPTION 'Unknown table: %', p_table_name;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not in draft state: % %', p_table_name, p_record_id;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION app_data.approve_safety_record(
  p_tenant_id  uuid,
  p_record_id  uuid,
  p_table_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'extensions'
AS $fn$
DECLARE
  v_tenant uuid := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
BEGIN
  IF v_tenant IS NULL OR (p_tenant_id IS NOT NULL AND p_tenant_id <> v_tenant) THEN
    RAISE EXCEPTION 'tenant mismatch' USING errcode = 'EQ010';
  END IF;

  IF p_table_name = 'prestart_checks' THEN
    UPDATE app_data.prestart_checks
       SET status = 'approved'
     WHERE prestart_id = p_record_id
       AND tenant_id   = v_tenant
       AND status      = 'submitted';

  ELSIF p_table_name = 'toolbox_talks' THEN
    UPDATE app_data.toolbox_talks
       SET status = 'approved'
     WHERE talk_id   = p_record_id
       AND tenant_id = v_tenant
       AND status    = 'submitted';

  ELSE
    RAISE EXCEPTION 'Unknown table: %', p_table_name;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not in submitted state: % %', p_table_name, p_record_id;
  END IF;
END;
$fn$;

-- authenticated Field users call these from the browser (Option B pattern).
-- anon has no business here; service_role goes direct to the tables.
REVOKE EXECUTE ON FUNCTION app_data.submit_safety_record(uuid, uuid, text)  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION app_data.approve_safety_record(uuid, uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION app_data.submit_safety_record(uuid, uuid, text)  TO authenticated;
GRANT  EXECUTE ON FUNCTION app_data.approve_safety_record(uuid, uuid, text) TO authenticated;

COMMIT;
