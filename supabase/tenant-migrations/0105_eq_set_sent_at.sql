-- Migration 0105
-- eq_set_sent_at — set or clear the sent date on a quote (tenant-scoped).
-- Accepts NULL to clear. Logs an audit row.

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_set_sent_at(
  p_quote_id  uuid,
  p_sent_at   timestamptz,
  p_initials  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_old_sent  timestamptz;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT sent_at INTO v_old_sent
  FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  UPDATE app_data.quote
  SET sent_at    = p_sent_at,
      updated_at = now()
  WHERE quote_id  = p_quote_id
    AND tenant_id = v_tenant_id;

  PERFORM public.eq__log_quote_audit(
    p_quote_id,
    'sent_at',
    jsonb_build_object(
      'old', v_old_sent,
      'new', p_sent_at
    ),
    p_initials
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_sent_at(uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_set_sent_at(uuid, timestamptz, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0105_eq_set_sent_at', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
