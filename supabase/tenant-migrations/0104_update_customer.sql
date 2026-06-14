-- Migration 0104
-- eq_update_customer — edit a customer's core fields by customer_id (tenant-scoped).

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_update_customer(
  p_customer_id   uuid,
  p_company_name  varchar DEFAULT NULL,
  p_email         varchar DEFAULT NULL,
  p_primary_phone varchar DEFAULT NULL,
  p_suburb        text    DEFAULT NULL,
  p_state         text    DEFAULT NULL
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
  UPDATE app_data.customers SET
    company_name  = COALESCE(p_company_name,  company_name),
    email         = p_email,
    primary_phone = p_primary_phone,
    suburb        = p_suburb,
    state         = p_state,
    updated_at    = now()
  WHERE customer_id = p_customer_id
    AND tenant_id   = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_customer(uuid, varchar, varchar, varchar, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_update_customer(uuid, varchar, varchar, varchar, text, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0104_update_customer', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
