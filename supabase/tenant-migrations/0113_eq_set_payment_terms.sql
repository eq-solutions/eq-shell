-- Migration 0113
-- eq_set_payment_terms — update payment terms and validity days inline
-- from the detail panel.

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_set_payment_terms(
  p_quote_id      uuid,
  p_payment_terms text    DEFAULT NULL,
  p_validity_days integer DEFAULT NULL,
  p_initials      text    DEFAULT NULL
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
  SET payment_terms = COALESCE(p_payment_terms, payment_terms),
      validity_days = COALESCE(p_validity_days, validity_days),
      updated_at    = now()
  WHERE quote_id  = p_quote_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  PERFORM public.eq__log_quote_audit(
    p_quote_id,
    'payment_terms',
    jsonb_build_object(
      'payment_terms', p_payment_terms,
      'validity_days', p_validity_days
    ),
    p_initials
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_payment_terms(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_set_payment_terms(uuid, text, integer, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0113_eq_set_payment_terms', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
