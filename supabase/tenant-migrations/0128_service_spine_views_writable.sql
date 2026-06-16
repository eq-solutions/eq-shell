-- 0128_service_spine_views_writable.sql
-- Target:  Per-tenant data plane (canonical app_data.*). No-op on the control plane.
-- Applied: VIA THE ONE PIPE ONLY (scripts/migrate-tenants.mjs, migrate-tenants.mjs,
--          Royce-dispatched). Do NOT apply this migration to any DB by hand.
--
-- Purpose: Make EQ Service's canonical bridge views WRITABLE ("edit anywhere").
--   EQ Service runs against db.schema='service' (eq-service lib/supabase/server.ts),
--   so its .from('customers'|'sites'|'assets').insert/.update/.delete resolve to the
--   service.* views created read-only by 0127. Plain views over a join/filter are
--   NOT auto-updatable, so today every Service write to those views errors. This
--   migration:
--     1. Adds 4 legit customer attribute columns to app_data.customers
--        (code, contract_template, logo_url, logo_url_on_dark) — Royce approved.
--        These were exposed as NULL::text in 0127 because they had no canonical home.
--     2. Recreates service.customers identical to 0127 EXCEPT the four NULL::text
--        placeholders become the real columns. Leading column order is unchanged
--        (only the source expression of those 4 changes; names + text types stay),
--        so CREATE OR REPLACE VIEW is legal. sites/assets views are UNCHANGED.
--     3. Adds INSTEAD OF INSERT/UPDATE/DELETE triggers on all three views so writes
--        flow through to app_data.* via the alias mapping below.
--
-- Alias mapping (view column -> app_data column) the triggers honour:
--   customers: id<-customer_id, name<-company_name, phone<-primary_phone,
--              address<-street_address, is_active<-active; code/contract_template/
--              logo_url/logo_url_on_dark are now real (added in step 1).
--   sites:     id<-site_id, city<-suburb, address<-address_line_1, is_active<-active.
--   assets:    id<-asset_id, manufacturer<-make, location<-location_in_site,
--              parent_id<-parent_asset_id, is_active<-active.
--
-- Write scope (derived from eq-service .insert/.update column sets — see PR body):
--   The triggers map ONLY the columns EQ Service actually writes AND that exist on
--   app_data.* (after step 1). View-computed columns are NEVER written back:
--   canonical_id, canonical_synced_at, and the duplicate company_name (mapped once
--   from NEW.name). EQ-Service-local columns with NO canonical home are NOT exposed
--   by these views at all (gate_code, parking_notes, after_hours_phone, safety_notes,
--   photo_url, logo_url/logo_url_on_dark on SITES; maximo_id, job_plan_id,
--   dark_site_test on ASSETS) — see PR body "no app_data home" flag. They are out of
--   scope for these triggers and are not silently dropped here because they never
--   reach the trigger (the view lacks the column → PostgREST rejects upstream).
--
-- DELETE = SOFT delete (active=false). Canonical rows are shared across apps; a hard
--   DELETE from Service must never destroy a Field/Quotes row. RETURN OLD.
--
-- INSERT sets service_enabled=true (so the new row is visible to Service) and
--   tenant_id = coalesce(NEW.tenant_id, JWT app_metadata.tenant_id). A new uuid pk is
--   minted with gen_random_uuid(). CUSTOMERS insert has a dedupe guard (Royce's
--   "create-anywhere WITH dedupe"): if an active same-tenant customer already exists
--   with a case/space-insensitive equal company_name, we flip that row's
--   service_enabled=true and return it instead of creating a duplicate. Sites/assets
--   insert straight (scoped by tenant / parent site).
--
-- All trigger functions: SECURITY INVOKER (app_data.* RLS enforces tenant isolation),
-- schema-qualified, search_path pinned. Idempotent; guarded on app_data.customers
-- existence so it no-ops on the control plane.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='app_data' AND table_name='customers'
  ) THEN
    RAISE NOTICE '0128: app_data.customers absent — control plane, skipping.';
    RETURN;
  END IF;

  -- 1. Add the 4 missing customer attribute columns (Royce approved).
  ALTER TABLE app_data.customers
    ADD COLUMN IF NOT EXISTS code text,
    ADD COLUMN IF NOT EXISTS contract_template text,
    ADD COLUMN IF NOT EXISTS logo_url text,
    ADD COLUMN IF NOT EXISTS logo_url_on_dark text;

  -- 2. Recreate service.customers: the four NULL::text placeholders from 0127 become
  --    the real columns. Every other column + the leading order is identical to 0127.
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
      code, contract_template, logo_url, logo_url_on_dark,
      customer_id AS canonical_id, updated_at AS canonical_synced_at
    FROM app_data.customers WHERE service_enabled = true
  $v$;
  EXECUTE 'ALTER VIEW service.customers SET (security_invoker = on)';
  EXECUTE 'GRANT SELECT ON service.customers TO authenticated';

  -- 3a. INSTEAD OF trigger fn — customers.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION service.tg_customers_iud()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = app_data, pg_temp
    AS $body$
    DECLARE
      v_tenant uuid;
      v_existing app_data.customers%ROWTYPE;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        -- Soft delete: never destroy a shared canonical row.
        UPDATE app_data.customers
          SET active = false, updated_at = now()
          WHERE customer_id = OLD.customer_id;
        RETURN OLD;

      ELSIF TG_OP = 'UPDATE' THEN
        UPDATE app_data.customers SET
          company_name      = NEW.name,
          code              = NEW.code,
          email             = NEW.email,
          primary_phone     = NEW.phone,
          street_address    = NEW.address,
          contract_template = NEW.contract_template,
          logo_url          = NEW.logo_url,
          logo_url_on_dark  = NEW.logo_url_on_dark,
          active            = NEW.is_active,
          updated_at        = now()
        WHERE customer_id = OLD.customer_id;
        RETURN NEW;

      ELSE  -- INSERT
        v_tenant := coalesce(
          NEW.tenant_id,
          nullif(current_setting('request.jwt.claims', true), '')::jsonb
            -> 'app_metadata' ->> 'tenant_id'
        )::uuid;

        -- Dedupe-on-create: reuse an active same-tenant customer with the same name.
        SELECT * INTO v_existing
          FROM app_data.customers
          WHERE tenant_id = v_tenant
            AND active = true
            AND lower(btrim(company_name)) = lower(btrim(NEW.name))
          LIMIT 1;

        IF FOUND THEN
          UPDATE app_data.customers
            SET service_enabled = true, updated_at = now()
            WHERE customer_id = v_existing.customer_id;
          NEW.id          := v_existing.customer_id;
          NEW.customer_id := v_existing.customer_id;
          NEW.tenant_id   := v_existing.tenant_id;
          RETURN NEW;
        END IF;

        INSERT INTO app_data.customers (
          customer_id, tenant_id, company_name, code, email, primary_phone,
          street_address, contract_template, logo_url, logo_url_on_dark,
          active, service_enabled, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), v_tenant, NEW.name, NEW.code, NEW.email, NEW.phone,
          NEW.address, NEW.contract_template, NEW.logo_url, NEW.logo_url_on_dark,
          coalesce(NEW.is_active, true), true, now(), now()
        )
        RETURNING customer_id INTO v_existing.customer_id;

        NEW.id          := v_existing.customer_id;
        NEW.customer_id := v_existing.customer_id;
        NEW.tenant_id   := v_tenant;
        RETURN NEW;
      END IF;
    END;
    $body$;
  $fn$;
  EXECUTE 'DROP TRIGGER IF EXISTS tg_customers_iud ON service.customers';
  EXECUTE 'CREATE TRIGGER tg_customers_iud INSTEAD OF INSERT OR UPDATE OR DELETE ON service.customers FOR EACH ROW EXECUTE FUNCTION service.tg_customers_iud()';

  -- 3b. INSTEAD OF trigger fn — sites.
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
          name           = NEW.name,
          code           = NEW.code,
          customer_id    = NEW.customer_id,
          address_line_1 = NEW.address,
          suburb         = NEW.city,
          state          = NEW.state,
          postcode       = NEW.postcode,
          country        = NEW.country,
          latitude       = NEW.latitude,
          longitude      = NEW.longitude,
          active         = NEW.is_active,
          updated_at     = now()
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
          active, service_enabled, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), v_tenant, NEW.name, NEW.code, NEW.customer_id, NEW.address,
          NEW.city, NEW.state, NEW.postcode, NEW.country, NEW.latitude, NEW.longitude,
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

  -- 3c. INSTEAD OF trigger fn — assets.
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
          serial_number, install_date, location_in_site, parent_asset_id,
          active, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), v_tenant, NEW.site_id, NEW.name, NEW.asset_type,
          NEW.manufacturer, NEW.model, NEW.serial_number, NEW.install_date,
          NEW.location, NEW.parent_id, coalesce(NEW.is_active, true), now(), now()
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
