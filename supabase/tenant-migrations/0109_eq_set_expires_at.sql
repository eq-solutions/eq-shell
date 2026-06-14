-- Migration 0109
-- eq_set_expires_at — extend or reset the expiry date on a quote.
-- Clears the "expired" status back to "submitted" when extending a quote
-- that has already auto-expired, so it re-enters the pipeline.

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_set_expires_at(
  p_quote_id   uuid,
  p_expires_at timestamptz,
  p_initials   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_old_exp   timestamptz;
  v_status    text;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT expires_at, status INTO v_old_exp, v_status
  FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  UPDATE app_data.quote
  SET expires_at = p_expires_at,
      -- Un-expire a quote that was auto-marked expired by the scheduler
      status     = CASE
                     WHEN v_status = 'expired' AND p_expires_at > now() THEN 'submitted'
                     ELSE v_status
                   END,
      updated_at = now()
  WHERE quote_id  = p_quote_id
    AND tenant_id = v_tenant_id;

  PERFORM public.eq__log_quote_audit(
    p_quote_id,
    'expires_at',
    jsonb_build_object('old', v_old_exp, 'new', p_expires_at),
    p_initials
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_expires_at(uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_set_expires_at(uuid, timestamptz, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0109_eq_set_expires_at', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
