-- 0127_service_spine_views_scoped.sql
-- Forward-fix to the service.customers/sites/assets bridge views (first created
-- MCP-only on ehow 2026-06-15, never backfilled to disk). EQ Service queries
-- db.schema='service' (eq-service lib/supabase/server.ts), so
-- from('customers'|'sites'|'assets') resolves to these views. Three fixes vs the
-- prior views:
--   1. + `active AS is_active` — eq-service filters .eq('is_active', true)
--      everywhere; the prior views exposed only `active` -> 400 (undefined column).
--   2. + WHERE service_enabled = true on customers/sites (module scoping: Service
--      sees its service-enabled spine rows, not the whole tenant). app_data.assets
--      has NO service_enabled column -> scoped via parent service-enabled site.
--   3. + columns eq-service selects that have no canonical source, as NULL/aliases
--      (code, contract_template, logo_url, logo_url_on_dark) + canonical_id (self)
--      + phone/address/city aliases.
-- security_invoker=on so app_data.* RLS (tenant_id = JWT app_metadata tenant_id)
-- does tenant isolation. SELECT-only bridge; write-through (edit-anywhere) is a
-- separate follow-up migration. Idempotent; guarded on app_data source existence
-- (no-ops on the control plane). NOTE: uses CREATE OR REPLACE VIEW which requires
-- the existing view's leading column order to be unchanged (it is — we only append
-- new columns). If a divergent plane throws 42P16, switch that view to DROP VIEW +
-- CREATE VIEW (0 dependents on ehow; verify per plane before using CASCADE).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='app_data' AND table_name='customers') THEN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='service' AND c.relname='customers' AND c.relkind='r') THEN
      EXECUTE 'DROP TABLE service.customers';
    END IF;
    EXECUTE $v$
      CREATE OR REPLACE VIEW service.customers AS
      SELECT customer_id AS id, customer_id, tenant_id, external_id, type,
        company_name AS name, company_name, first_name, last_name, salutation,
        abn, acn, street_address, suburb, state, postcode, country,
        postal_address, postal_suburb, postal_state, postal_postcode, postal_country,
        primary_phone, mobile_phone, alt_phone, fax, email, website,
        customer_group, customer_profile, account_manager, currency,
        default_quote_method, default_invoice_method, default_job_method,
        referred_by, notes, active, created_date, imported_at, imported_from,
        intake_id, schema_version, created_at, updated_at, created_by, updated_by,
        field_enabled, service_enabled,
        active AS is_active, primary_phone AS phone, street_address AS address,
        NULL::text AS code, NULL::text AS contract_template,
        NULL::text AS logo_url, NULL::text AS logo_url_on_dark,
        customer_id AS canonical_id, updated_at AS canonical_synced_at
      FROM app_data.customers WHERE service_enabled = true
    $v$;
    EXECUTE 'ALTER VIEW service.customers SET (security_invoker = on)';
    EXECUTE 'GRANT SELECT ON service.customers TO authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='app_data' AND table_name='sites') THEN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='service' AND c.relname='sites' AND c.relkind='r') THEN
      EXECUTE 'DROP TABLE service.sites';
    END IF;
    EXECUTE $v$
      CREATE OR REPLACE VIEW service.sites AS
      SELECT site_id AS id, site_id, tenant_id, external_id, customer_id, external_customer_id,
        name, code, client_name, site_type, address_line_1, address_line_2,
        suburb, state, postcode, country, latitude, longitude,
        site_contact_name, site_contact_phone, site_contact_email,
        induction_required, induction_url, active, notes,
        imported_at, imported_from, intake_id, schema_version,
        created_at, updated_at, created_by, updated_by,
        track_hours, budget_hours, slug, field_enabled, service_enabled,
        active AS is_active, suburb AS city, address_line_1 AS address
      FROM app_data.sites WHERE service_enabled = true
    $v$;
    EXECUTE 'ALTER VIEW service.sites SET (security_invoker = on)';
    EXECUTE 'GRANT SELECT ON service.sites TO authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='app_data' AND table_name='assets') THEN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='service' AND c.relname='assets' AND c.relkind='r') THEN
      EXECUTE 'DROP TABLE service.assets';
    END IF;
    EXECUTE $v$
      CREATE OR REPLACE VIEW service.assets AS
      SELECT asset_id AS id, asset_id, tenant_id, external_id, site_id, parent_asset_id,
        asset_type, name, make, model, serial_number, rating, install_date,
        warranty_expires, criticality, condition, service_schedule_id, ppm_frequency,
        last_service_date, next_service_due, location_in_site, barcode, active,
        defects_summary, client_classification, notes, imported_at, imported_from,
        intake_id, schema_version, created_at, updated_at, created_by, updated_by,
        cert_url, assigned_to,
        active AS is_active, make AS manufacturer, location_in_site AS location,
        parent_asset_id AS parent_id
      FROM app_data.assets
      WHERE site_id IN (SELECT site_id FROM app_data.sites WHERE service_enabled = true)
    $v$;
    EXECUTE 'ALTER VIEW service.assets SET (security_invoker = on)';
    EXECUTE 'GRANT SELECT ON service.assets TO authenticated';
  END IF;
END $$;
