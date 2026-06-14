-- Migration 0103
-- eq_update_contact — edit a contact by contact_id (tenant-scoped).
-- All fields are overwritten directly (NULL accepted to clear a field).

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_update_contact(
  p_contact_id   uuid,
  p_first_name   varchar DEFAULT NULL,
  p_last_name    varchar DEFAULT NULL,
  p_email        varchar DEFAULT NULL,
  p_mobile_phone varchar DEFAULT NULL,
  p_position     varchar DEFAULT NULL
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
  UPDATE app_data.contacts SET
    first_name   = p_first_name,
    last_name    = p_last_name,
    email        = p_email,
    mobile_phone = p_mobile_phone,
    position     = p_position,
    updated_at   = now()
  WHERE contact_id = p_contact_id
    AND tenant_id  = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_contact(uuid, varchar, varchar, varchar, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_update_contact(uuid, varchar, varchar, varchar, varchar, varchar) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0103_update_contact', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
