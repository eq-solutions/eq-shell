-- Migration 0114
-- eq_set_quote_recipient — update the Attention block and delivery address
-- inline from the detail panel. Any NULL arg leaves that field unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_set_quote_recipient(
  p_quote_id        uuid,
  p_attn_first_name text DEFAULT NULL,
  p_attn_name       text DEFAULT NULL,
  p_attn_phone      text DEFAULT NULL,
  p_address         text DEFAULT NULL,
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
  SET attn_first_name = COALESCE(p_attn_first_name, attn_first_name),
      attn_name       = COALESCE(p_attn_name,       attn_name),
      attn_phone      = COALESCE(p_attn_phone,      attn_phone),
      address         = COALESCE(p_address,         address),
      updated_at      = now()
  WHERE quote_id  = p_quote_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  PERFORM public.eq__log_quote_audit(
    p_quote_id,
    'recipient',
    jsonb_build_object(
      'attn_first_name', p_attn_first_name,
      'attn_name',       p_attn_name,
      'attn_phone',      p_attn_phone,
      'address',         p_address
    ),
    p_initials
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_quote_recipient(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_set_quote_recipient(uuid, text, text, text, text, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0114_eq_set_quote_recipient', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
