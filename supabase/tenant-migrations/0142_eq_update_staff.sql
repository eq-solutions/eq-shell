-- Migration: 0142_eq_update_staff
-- Target:    Per-tenant data plane
-- Purpose:   Authenticated RPC for updating editable staff fields from the
--            Shell Staff page. Tenant-gated: only updates rows owned by the
--            caller's tenant. Returns TRUE if a row was updated.
--
--            first_name / last_name are preserved if empty string is passed
--            (COALESCE guard). Other nullable fields accept empty string as
--            an intentional clear (NULLIF).

CREATE OR REPLACE FUNCTION public.eq_update_staff(
  p_staff_id        uuid,
  p_first_name      text DEFAULT NULL,
  p_last_name       text DEFAULT NULL,
  p_email           text DEFAULT NULL,
  p_phone           text DEFAULT NULL,
  p_trade           text DEFAULT NULL,
  p_level           text DEFAULT NULL,
  p_employment_type text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  UPDATE app_data.staff SET
    first_name      = COALESCE(NULLIF(trim(p_first_name), ''),      first_name),
    last_name       = COALESCE(NULLIF(trim(p_last_name), ''),       last_name),
    email           = NULLIF(trim(p_email),           ''),
    phone           = NULLIF(trim(p_phone),           ''),
    trade           = NULLIF(trim(p_trade),           ''),
    level           = NULLIF(trim(p_level),           ''),
    employment_type = NULLIF(trim(p_employment_type), ''),
    updated_at      = now()
  WHERE staff_id  = p_staff_id
    AND tenant_id = v_tenant_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_staff(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_staff(uuid, text, text, text, text, text, text, text) TO authenticated;
