-- Migration 0110
-- eq_set_quote_scope — update scope_of_works, clarifications, and quote_notes
-- inline from the detail panel without requiring a full quote edit.

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_set_quote_scope(
  p_quote_id        uuid,
  p_scope_of_works  text DEFAULT NULL,
  p_clarifications  text DEFAULT NULL,
  p_quote_notes     text DEFAULT NULL,
  p_initials        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  UPDATE app_data.quote
  SET scope_of_works = p_scope_of_works,
      clarifications = p_clarifications,
      notes          = p_quote_notes,
      updated_at     = now()
  WHERE quote_id  = p_quote_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  PERFORM public.eq__log_quote_audit(
    p_quote_id,
    'scope',
    jsonb_build_object('updated', true),
    p_initials
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_quote_scope(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_set_quote_scope(uuid, text, text, text, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0110_eq_set_quote_scope', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
