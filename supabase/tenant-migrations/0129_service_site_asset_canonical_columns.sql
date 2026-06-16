-- 0129_service_site_asset_canonical_columns.sql
-- Target:  Per-tenant data plane (canonical app_data.*). No-op on the control plane.
-- Applied: VIA THE ONE PIPE ONLY (scripts/migrate-tenants.mjs, tenant-migrate.yml,
--          Royce-dispatched). Do NOT apply this migration to any DB by hand.
--
-- Purpose: Finish EQ Service's "edit anywhere" for SITES and ASSETS. 0128 made the
--   service.customers/sites/assets bridge views writable, but only added customer
--   attribute columns to canonical. EQ Service's site + asset write payloads still
--   carry columns that have NO canonical home, so PostgREST 400s the whole
--   .insert/.update before the trigger ever runs (the view lacks the column).
--
--   Verified write payloads (eq-solves-service app/(app)/sites/actions.ts +
--   app/(app)/assets/actions.ts, validated by lib/validations/{site,asset}.ts):
--     sites  .insert/.update  -> name, code, customer_id, address, city, state,
--            postcode, country, latitude, longitude, is_active  (already in view)
--            + gate_code, parking_notes, after_hours_phone, safety_notes,
--              photo_url, logo_url, logo_url_on_dark            (MISSING -> 400)
--     assets .insert/.update  -> site_id, name, asset_type, manufacturer, model,
--            serial_number, install_date, location, parent_id, is_active (in view)
--            + maximo_id                                        (MISSING -> 400)
--            + job_plan_id, dark_site_test  (Service-LOCAL; intentionally NOT
--              given a canonical home — handled out-of-band on the Service side)
--
-- This migration:
--   1. Adds the 7 site-access / branding columns to app_data.sites and maximo_id
--      to app_data.assets. These belong canonical: site access + operational notes
--      and branding are cross-app (EQ Field cares about them too); maximo_id is an
--      external-system ref that any app may reconcile against.
--   2. Recreates service.sites / service.assets identical to 0127/0128 EXCEPT the
--      new columns are appended (leading column order + types unchanged -> CREATE OR
--      REPLACE VIEW is legal; INSTEAD OF triggers survive a replace).
--   3. Updates the INSTEAD OF UPDATE/INSERT trigger fns (from 0128) to map the new
--      columns through to app_data.*. DELETE is unchanged (soft delete).
--
-- NOT in scope (deliberately): asset job_plan_id (link to a Service maintenance plan
--   — Service workflow domain) and dark_site_test (Service test config). These get NO
--   canonical column and are NOT exposed by service.assets. EQ Service must stop
--   sending them through the canonical write path (Service-local sidecar or drop from
--   the asset payload). That is an eq-solves-service change, tracked separately.
--
-- service.customers + its trigger are UNCHANGED here.
--
-- All trigger functions: SECURITY INVOKER (app_data.* RLS enforces tenant isolation),
-- schema-qualified, search_path pinned. Idempotent; guarded on app_data source
-- existence so it no-ops on the control plane.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='app_data' AND table_name='sites'
  ) THEN
    RAISE NOTICE '0129: app_data.sites absent — control plane, skipping.';
    RETURN;
  END IF;

  ------------------------------------------------------------------------------
  -- 1. New canonical columns.
  ------------------------------------------------------------------------------
  ALTER TABLE app_data.sites
    ADD COLUMN IF NOT EXISTS gate_code text,
    ADD COLUMN IF NOT EXISTS parking_notes text,
    ADD COLUMN IF NOT EXISTS after_hours_phone text,
    ADD COLUMN IF NOT EXISTS safety_notes text,
    ADD COLUMN IF NOT EXISTS photo_url text,
    ADD COLUMN IF NOT EXISTS logo_url text,
    ADD COLUMN IF NOT EXISTS logo_url_on_dark text;

  ALTER TABLE app_data.assets
    ADD COLUMN IF NOT EXISTS maximo_id text;

  ------------------------------------------------------------------------------
  -- 2a. Recreate service.sites with the 7 new columns appended.
  ------------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='service' AND c.relname='sites' AND c.relkind='r') THEN
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
      active AS is_active, suburb AS city, address_line_1 AS address,
      gate_code, parking_notes, after_hours_phone, safety_notes,
      photo_url, logo_url, logo_url_on_dark
    FROM app_data.sites WHERE service_enabled = true
  $v$;
  EXECUTE 'ALTER VIEW service.sites SET (security_invoker = on)';
  EXECUTE 'GRANT SELECT ON service.sites TO authenticated';

  ------------------------------------------------------------------------------
  -- 2b. Recreate service.assets with maximo_id appended.
  ------------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='service' AND c.relname='assets' AND c.relkind='r') THEN
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
      parent_asset_id AS parent_id,
      maximo_id
    FROM app_data.assets
    WHERE site_id IN (SELECT site_id FROM app_data.sites WHERE service_enabled = true)
  $v$;
  EXECUTE 'ALTER VIEW service.assets SET (security_invoker = on)';
  EXECUTE 'GRANT SELECT ON service.assets TO authenticated';

  ------------------------------------------------------------------------------
  -- 3a. service.sites INSTEAD OF trigger fn — map the new columns through.
  ------------------------------------------------------------------------------
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION service.tg_sites_iud()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = app_data, pg_temp
    AS $body$
    DECLARE
      v_tenant uuid;
      v_id uuid;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        UPDATE app_data.sites
          SET active = false, updated_at = now()
          WHERE site_id = OLD.site_id;
        RETURN OLD;

      ELSIF TG_OP = 'UPDATE' THEN
        UPDATE app_data.sites SET
          name              = NEW.name,
          code              = NEW.code,
          customer_id       = NEW.customer_id,
          address_line_1    = NEW.address,
          suburb            = NEW.city,
          state             = NEW.state,
          postcode          = NEW.postcode,
          country           = NEW.country,
          latitude          = NEW.latitude,
          longitude         = NEW.longitude,
          gate_code         = NEW.gate_code,
          parking_notes     = NEW.parking_notes,
          after_hours_phone = NEW.after_hours_phone,
          safety_notes      = NEW.safety_notes,
          photo_url         = NEW.photo_url,
          logo_url          = NEW.logo_url,
          logo_url_on_dark  = NEW.logo_url_on_dark,
          active            = NEW.is_active,
          updated_at        = now()
        WHERE site_id = OLD.site_id;
        RETURN NEW;

      ELSE  -- INSERT
        v_tenant := coalesce(
          NEW.tenant_id,
          nullif(current_setting('request.jwt.claims', true), '')::jsonb
            -> 'app_metadata' ->> 'tenant_id'
        )::uuid;

        INSERT INTO app_data.sites (
          site_id, tenant_id, name, code, customer_id, address_line_1,
          suburb, state, postcode, country, latitude, longitude,
          gate_code, parking_notes, after_hours_phone, safety_notes,
          photo_url, logo_url, logo_url_on_dark,
          active, service_enabled, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), v_tenant, NEW.name, NEW.code, NEW.customer_id, NEW.address,
          NEW.city, NEW.state, NEW.postcode, NEW.country, NEW.latitude, NEW.longitude,
          NEW.gate_code, NEW.parking_notes, NEW.after_hours_phone, NEW.safety_notes,
          NEW.photo_url, NEW.logo_url, NEW.logo_url_on_dark,
          coalesce(NEW.is_active, true), true, now(), now()
        )
        RETURNING site_id INTO v_id;

        NEW.id        := v_id;
        NEW.site_id   := v_id;
        NEW.tenant_id := v_tenant;
        RETURN NEW;
      END IF;
    END;
    $body$;
  $fn$;
  EXECUTE 'DROP TRIGGER IF EXISTS tg_sites_iud ON service.sites';
  EXECUTE 'CREATE TRIGGER tg_sites_iud INSTEAD OF INSERT OR UPDATE OR DELETE ON service.sites FOR EACH ROW EXECUTE FUNCTION service.tg_sites_iud()';

  ------------------------------------------------------------------------------
  -- 3b. service.assets INSTEAD OF trigger fn — map maximo_id through.
  ------------------------------------------------------------------------------
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION service.tg_assets_iud()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = app_data, pg_temp
    AS $body$
    DECLARE
      v_tenant uuid;
      v_id uuid;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        UPDATE app_data.assets
          SET active = false, updated_at = now()
          WHERE asset_id = OLD.asset_id;
        RETURN OLD;

      ELSIF TG_OP = 'UPDATE' THEN
        UPDATE app_data.assets SET
          site_id          = NEW.site_id,
          name             = NEW.name,
          asset_type       = NEW.asset_type,
          make             = NEW.manufacturer,
          model            = NEW.model,
          serial_number    = NEW.serial_number,
          maximo_id        = NEW.maximo_id,
          install_date     = NEW.install_date,
          location_in_site = NEW.location,
          parent_asset_id  = NEW.parent_id,
          active           = NEW.is_active,
          updated_at       = now()
        WHERE asset_id = OLD.asset_id;
        RETURN NEW;

      ELSE  -- INSERT
        v_tenant := coalesce(
          NEW.tenant_id,
          nullif(current_setting('request.jwt.claims', true), '')::jsonb
            -> 'app_metadata' ->> 'tenant_id'
        )::uuid;

        INSERT INTO app_data.assets (
          asset_id, tenant_id, site_id, name, asset_type, make, model,
          serial_number, maximo_id, install_date, location_in_site, parent_asset_id,
          active, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), v_tenant, NEW.site_id, NEW.name, NEW.asset_type,
          NEW.manufacturer, NEW.model, NEW.serial_number, NEW.maximo_id,
          NEW.install_date, NEW.location, NEW.parent_id, coalesce(NEW.is_active, true),
          now(), now()
        )
        RETURNING asset_id INTO v_id;

        NEW.id        := v_id;
        NEW.asset_id  := v_id;
        NEW.tenant_id := v_tenant;
        RETURN NEW;
      END IF;
    END;
    $body$;
  $fn$;
  EXECUTE 'DROP TRIGGER IF EXISTS tg_assets_iud ON service.assets';
  EXECUTE 'CREATE TRIGGER tg_assets_iud INSTEAD OF INSERT OR UPDATE OR DELETE ON service.assets FOR EACH ROW EXECUTE FUNCTION service.tg_assets_iud()';

END $$;
