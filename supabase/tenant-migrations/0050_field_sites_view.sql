-- 0050_field_sites_view.sql
--
-- Creates app_data.field_sites as a view over app_data.sites.
-- EQ Field's supabase.js JWT routing rewrites `sites` → `field_sites` so
-- the JWT-authenticated path lands on this view. The view uses
-- security_invoker=on so queries run as the authenticated user and the
-- sites_tenant_isolation RLS policy (tenant_id = JWT app_metadata tenant_id)
-- filters correctly — each user sees only their tenant's sites.
--
-- Column mapping matches Field's expected site object shape:
--   id          ← site_id  (uuid PK)
--   abbr        ← code     (sparse — 52/591 populated; null is fine)
--   address     ← address_line_1
--   site_lead   ← site_contact_name
--   site_lead_phone ← site_contact_phone
--
-- Write path: Field's save/delete operations still go to the legacy path
-- until a proper write adapter is built. This view is SELECT-only.
--
-- Safe on planes without app_data.sites (early-exit guard not needed —
-- the view CREATE will simply fail if the table is absent, which is fine;
-- only ehow/zaap have app_data).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sites'
  ) THEN
    RETURN;
  END IF;

  EXECUTE $sql$
    CREATE OR REPLACE VIEW app_data.field_sites AS
    SELECT
      site_id              AS id,
      tenant_id,
      customer_id,
      name,
      code                 AS abbr,
      address_line_1       AS address,
      suburb,
      state,
      postcode,
      site_contact_name    AS site_lead,
      site_contact_phone   AS site_lead_phone,
      active,
      slug,
      notes,
      created_at,
      updated_at
    FROM app_data.sites;
  $sql$;

  EXECUTE $sql$
    ALTER VIEW app_data.field_sites SET (security_invoker = on);
  $sql$;

  EXECUTE $sql$
    GRANT SELECT ON app_data.field_sites TO authenticated;
  $sql$;
END $$;
