-- Migration: 0132_eq_list_sites_extend
-- Target:    Per-tenant data plane
-- Purpose:   Extend eq_list_sites(p_customer_id) to return suburb, state,
--            and site_contact_* fields so the EQ Ops and EQ Shell CRM surfaces
--            can pre-populate the site edit form without a second round-trip.
--
-- The (p_search, p_show_archived) overload from 0022 is unaffected.
-- Only the (p_customer_id uuid) overload introduced in 0072 is extended.

CREATE OR REPLACE FUNCTION public.eq_list_sites(
  p_customer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  site_id              uuid,
  name                 text,
  code                 text,
  customer_id          uuid,
  suburb               text,
  state                text,
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
    s.suburb::text,
    s.state::text,
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
