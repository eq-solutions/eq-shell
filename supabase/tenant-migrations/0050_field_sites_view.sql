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
-- Zaap compat: zaap has app_data.field_sites as an empty legacy TABLE from
-- the EQ Field boot migration (different column shape, 0 rows, no dependents).
-- We drop it and replace with the view.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sites'
  ) THEN
    RETURN;
  END IF;

  -- Drop the legacy empty table if it exists as a TABLE (not a view).
  -- On zaap this was created by an earlier boot migration with a different
  -- column shape. It is empty (0 rows) and has no dependents.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app_data' AND c.relname = 'field_sites' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'DROP TABLE app_data.field_sites';
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
