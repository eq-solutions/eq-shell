-- Migration: 0118_contact_site_links
-- Target:    Per-tenant data plane (ehowgjardagevnrluult + future tenants)
-- Purpose:   Prevent duplicate contacts/sites by linking them properly.
--
--   contact_site_links            — many-to-many contacts↔sites
--   eq_assign_site_to_customer    — re-point sites.customer_id (deduplicate sites)
--   eq_link_contact_to_site       — upsert a contact→site link
--   eq_unlink_contact_from_site   — remove a contact→site link
--   eq_list_contacts_for_site     — list contacts linked to a site
--
-- eq_list_sites already exists (mig 0072); called with p_customer_id=NULL
-- returns all tenant sites; with a value returns sites for that customer.

BEGIN;

-- ============================================================================
-- 1. contact_site_links table
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.contact_site_links (
  link_id     uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  contact_id  uuid        NOT NULL,
  site_id     uuid        NOT NULL,
  role        text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_site_links_pkey PRIMARY KEY (link_id),
  CONSTRAINT contact_site_links_contact_site_key UNIQUE (contact_id, site_id),
  CONSTRAINT contact_site_links_contact_fk FOREIGN KEY (contact_id)
    REFERENCES app_data.contacts(contact_id) ON DELETE CASCADE,
  CONSTRAINT contact_site_links_site_fk FOREIGN KEY (site_id)
    REFERENCES app_data.sites(site_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_csl_contact ON app_data.contact_site_links (contact_id);
CREATE INDEX IF NOT EXISTS idx_csl_site    ON app_data.contact_site_links (site_id);
CREATE INDEX IF NOT EXISTS idx_csl_tenant  ON app_data.contact_site_links (tenant_id);

ALTER TABLE app_data.contact_site_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csl_tenant_read ON app_data.contact_site_links;
CREATE POLICY csl_tenant_read ON app_data.contact_site_links
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

REVOKE ALL    ON app_data.contact_site_links FROM anon, authenticated;
GRANT  SELECT ON app_data.contact_site_links TO authenticated;
GRANT  ALL    ON app_data.contact_site_links TO service_role;

-- ============================================================================
-- 2. eq_assign_site_to_customer
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_assign_site_to_customer(
  p_site_id     uuid,
  p_customer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  UPDATE app_data.sites
  SET customer_id = p_customer_id,
      updated_at  = now()
  WHERE site_id   = p_site_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'site not found or access denied';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_assign_site_to_customer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_assign_site_to_customer(uuid, uuid) TO authenticated;

-- ============================================================================
-- 3. eq_link_contact_to_site
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_link_contact_to_site(
  p_contact_id  uuid,
  p_site_id     uuid,
  p_role        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.contacts
    WHERE contact_id = p_contact_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'contact not found or access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.sites
    WHERE site_id = p_site_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'site not found or access denied';
  END IF;

  INSERT INTO app_data.contact_site_links (tenant_id, contact_id, site_id, role)
  VALUES (v_tenant_id, p_contact_id, p_site_id, p_role)
  ON CONFLICT (contact_id, site_id) DO UPDATE
    SET role       = EXCLUDED.role,
        active     = true,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.eq_link_contact_to_site(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_link_contact_to_site(uuid, uuid, text) TO authenticated;

-- ============================================================================
-- 4. eq_unlink_contact_from_site
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_unlink_contact_from_site(
  p_contact_id uuid,
  p_site_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  DELETE FROM app_data.contact_site_links
  WHERE contact_id = p_contact_id
    AND site_id    = p_site_id
    AND tenant_id  = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_unlink_contact_from_site(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_unlink_contact_from_site(uuid, uuid) TO authenticated;

-- ============================================================================
-- 5. eq_list_contacts_for_site
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_contacts_for_site(p_site_id uuid)
RETURNS TABLE (
  contact_id       uuid,
  first_name       text,
  last_name        text,
  email            text,
  work_phone       text,
  mobile_phone     text,
  contact_position text,
  role             text
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
    co.contact_id,
    co.first_name::text,
    co.last_name::text,
    co.email::text,
    co.work_phone::text,
    co.mobile_phone::text,
    co."position"::text,
    csl.role::text
  FROM app_data.contact_site_links csl
  JOIN app_data.contacts co ON co.contact_id = csl.contact_id
  WHERE csl.site_id   = p_site_id
    AND csl.tenant_id = v_tenant_id
    AND csl.active    = true
    AND COALESCE(co.active, true) = true
  ORDER BY co.last_name, co.first_name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_contacts_for_site(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_contacts_for_site(uuid) TO authenticated;

COMMIT;
