-- Migration 0107
-- eq_link_quote_contact — link a contact to a quote and sync the attn block.
--
-- Sets quote.contact_id and copies first_name, last_name, mobile_phone/work_phone
-- into the attn_first_name, attn_name, attn_phone denormalised columns.
-- Pass p_contact_id = NULL to unlink without touching the attn fields.

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_link_quote_contact(
  p_quote_id    uuid,
  p_contact_id  uuid,
  p_initials    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_contact     RECORD;
  v_old_cid     uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT contact_id INTO v_old_cid
  FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT first_name, last_name, email, mobile_phone, work_phone
    INTO v_contact
    FROM app_data.contacts
    WHERE contact_id = p_contact_id AND tenant_id = v_tenant_id AND COALESCE(active, true) = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'contact not found or access denied';
    END IF;

    UPDATE app_data.quote
    SET contact_id      = p_contact_id,
        attn_first_name = COALESCE(v_contact.first_name, attn_first_name),
        attn_name       = COALESCE(v_contact.last_name, attn_name),
        attn_phone      = COALESCE(v_contact.mobile_phone, v_contact.work_phone, attn_phone),
        updated_at      = now()
    WHERE quote_id  = p_quote_id
      AND tenant_id = v_tenant_id;
  ELSE
    UPDATE app_data.quote
    SET contact_id = NULL,
        updated_at = now()
    WHERE quote_id  = p_quote_id
      AND tenant_id = v_tenant_id;
  END IF;

  PERFORM public.eq__log_quote_audit(
    p_quote_id,
    'contact_linked',
    jsonb_build_object('old_contact_id', v_old_cid, 'new_contact_id', p_contact_id),
    p_initials
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_link_quote_contact(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_link_quote_contact(uuid, uuid, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0107_eq_link_quote_contact', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
