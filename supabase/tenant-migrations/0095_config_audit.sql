-- Config-level audit log for Setup changes (rate presets, pricing config, templates).
-- Separate from quote_audit (which requires a quote_id).

CREATE TABLE IF NOT EXISTS app_data.config_audit (
  audit_id       uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  entity_type    text        NOT NULL,
  entity_id      uuid,
  action         text        NOT NULL,
  label          text,
  changes        jsonb,
  actor_initials text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT config_audit_pkey PRIMARY KEY (audit_id)
);

CREATE INDEX IF NOT EXISTS config_audit_tenant_created_idx
  ON app_data.config_audit (tenant_id, created_at DESC);

GRANT ALL ON app_data.config_audit TO service_role;
ALTER TABLE app_data.config_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_audit_tenant_isolation ON app_data.config_audit;
CREATE POLICY config_audit_tenant_isolation ON app_data.config_audit
  FOR ALL TO authenticated
  USING      (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid)
  WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid);

-- RPC callable by authenticated users to log config changes
CREATE OR REPLACE FUNCTION public.eq_log_config_audit(
  p_entity_type  text,
  p_action       text,
  p_entity_id    uuid    DEFAULT NULL,
  p_label        text    DEFAULT NULL,
  p_changes      jsonb   DEFAULT NULL,
  p_initials     text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_data
AS $$
DECLARE
  v_tenant_id uuid := ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id missing from JWT';
  END IF;
  INSERT INTO app_data.config_audit
    (tenant_id, entity_type, entity_id, action, label, changes, actor_initials)
  VALUES
    (v_tenant_id, p_entity_type, p_entity_id, p_action, p_label, p_changes, p_initials);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_log_config_audit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_log_config_audit TO authenticated;
