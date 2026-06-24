-- Migration: 0141_eq_list_sites_address
-- Target:    Per-tenant data plane
-- Purpose:   Extend eq_list_sites(p_customer_id) to return address_line_1
--            and postcode so the create-quote form can auto-populate the
--            address field (used in Word doc export) when a site is selected.
--            suburb and state were added in 0132; this completes the set.

-- DROP required because return type changes (PG error 42P13)
DROP FUNCTION IF EXISTS public.eq_list_sites(uuid);

CREATE OR REPLACE FUNCTION public.eq_list_sites(
  p_customer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  site_id              uuid,
  name                 text,
  code                 text,
  customer_id          uuid,
  address_line_1       text,
  suburb               text,
  state                text,
  postcode             text,
  site_contact_name    text,
  site_contact_phone   text,
  site_contact_email   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  RETURN QUERY
  SELECT
    s.site_id,
    s.name::text,
    s.code::text,
    s.customer_id,
    s.address_line_1::text,
    s.suburb::text,
    s.state::text,
    s.postcode::text,
    s.site_contact_name::text,
    s.site_contact_phone::text,
    s.site_contact_email::text
  FROM app_data.sites s
  WHERE s.tenant_id = v_tenant_id
    AND s.active    = true
    AND (p_customer_id IS NULL OR s.customer_id = p_customer_id)
  ORDER BY s.name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_sites(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_sites(uuid) TO authenticated;
