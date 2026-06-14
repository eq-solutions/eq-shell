-- Migration 0100: eq_list_config_audit
-- Reads config_audit entries for the current authenticated tenant.
-- tenant_id is pulled from the JWT — callers don't pass it.
-- Used by the Setup > History tab in EQ Ops.

CREATE OR REPLACE FUNCTION public.eq_list_config_audit(p_limit INT DEFAULT 50)
RETURNS TABLE(
  audit_id      UUID,
  entity_type   TEXT,
  entity_id     TEXT,
  action        TEXT,
  label         TEXT,
  changes       JSONB,
  actor_initials TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id UUID := (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::UUID;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    ca.audit_id,
    ca.entity_type,
    ca.entity_id,
    ca.action,
    ca.label,
    ca.changes,
    ca.actor_initials,
    ca.created_at
  FROM app_data.config_audit ca
  WHERE ca.tenant_id = v_tenant_id
  ORDER BY ca.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_config_audit(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_config_audit(INT) TO authenticated;
