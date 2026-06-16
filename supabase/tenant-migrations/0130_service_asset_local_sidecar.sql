-- 0130_service_asset_local_sidecar.sql
-- Target:  Per-tenant data plane. No-op on the control plane.
-- Applied: VIA THE ONE PIPE ONLY (tenant-migrate.yml, Royce-dispatched).
--          Do NOT apply by hand.
--
-- Purpose: Give EQ Service's two asset-level Service-LOCAL fields a home that is
--   NOT canonical (app_data), completing asset "edit anywhere".
--
--   job_plan_id    — link from an asset to a Service maintenance plan (CMMS
--                    workflow; Service-only meaning).
--   dark_site_test — Service test-config flag.
--
--   These are deliberately kept OUT of canonical (app_data.assets stays the pure,
--   cross-app surface — see 0129). But EQ Service runs against db.schema='service',
--   so `from('assets')` resolves to the service.assets VIEW; the app both WRITES
--   these two (every .insert/.update payload) and READS them in ~27 places
--   (scope-context matching, reports, AssetForm). With no view column for them,
--   both writes (400) and reads (undefined column) break.
--
--   Solution: a Service-owned sidecar on the SAME tenant DB but in the `service`
--   schema (not app_data) — keyed 1:1 to the canonical asset by asset_id. The
--   service.assets view LEFT JOINs it so reads are transparent; the INSTEAD OF
--   trigger routes the two columns to the sidecar and everything else to
--   app_data.assets. Net result: zero eq-solves-service code change; canonical
--   stays clean.
--
--   BACKFILL NOTE (pre-apply, for Royce): the pre-canonical service.assets table
--   that previously held job_plan_id/dark_site_test was dropped in the 0127 cutover
--   (verified 2026-06-16: no current table on ehow carries these columns). This
--   sidecar therefore starts EMPTY — existing assets read job_plan_id=NULL /
--   dark_site_test=false until re-entered or backfilled from a pre-0127 backup.
--   Going forward every Service asset edit repopulates it. If the historical values
--   matter, recover them from a backup of the old service.assets table and INSERT
--   into service.asset_local BEFORE relying on the reads.
--
-- Trigger fn: SECURITY INVOKER (RLS on both app_data.assets and service.asset_local
-- enforces tenant isolation), schema-qualified, search_path pinned. Idempotent;
-- guarded on app_data.assets existence so it no-ops on the control plane.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='app_data' AND table_name='assets'
  ) THEN
    RAISE NOTICE '0130: app_data.assets absent — control plane, skipping.';
    RETURN;
  END IF;

  ------------------------------------------------------------------------------
  -- 1. Service-local sidecar (NOT canonical — lives in the `service` schema).
  ------------------------------------------------------------------------------
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS service';
  EXECUTE 'GRANT USAGE ON SCHEMA service TO authenticated';

  CREATE TABLE IF NOT EXISTS service.asset_local (
    asset_id       uuid PRIMARY KEY REFERENCES app_data.assets(asset_id) ON DELETE CASCADE,
    tenant_id      uuid NOT NULL,
    job_plan_id    uuid,
    dark_site_test boolean NOT NULL DEFAULT false,
    updated_at     timestamptz NOT NULL DEFAULT now()
  );

  -- RLS: tenant-scoped (same JWT app_metadata.tenant_id claim every app_data
  -- policy reads). No anon/authenticated default grant relied upon — explicit only.
  EXECUTE 'ALTER TABLE service.asset_local ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS asset_local_tenant ON service.asset_local';
  EXECUTE $pol$
    CREATE POLICY asset_local_tenant ON service.asset_local
      FOR ALL TO authenticated
      USING      (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
  $pol$;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON service.asset_local TO authenticated';
  EXECUTE 'GRANT ALL ON service.asset_local TO service_role';

  ------------------------------------------------------------------------------
  -- 2. Recreate service.assets: LEFT JOIN the sidecar, append the two columns.
  --    Existing column list (from 0129) is unchanged in name/type/order — only
  --    source-aliased to `a.` — so CREATE OR REPLACE VIEW is legal.
  ------------------------------------------------------------------------------
  EXECUTE $v$
    CREATE OR REPLACE VIEW service.assets AS
    SELECT a.asset_id AS id, a.asset_id, a.tenant_id, a.external_id, a.site_id, a.parent_asset_id,
      a.asset_type, a.name, a.make, a.model, a.serial_number, a.rating, a.install_date,
      a.warranty_expires, a.criticality, a.condition, a.service_schedule_id, a.ppm_frequency,
      a.last_service_date, a.next_service_due, a.location_in_site, a.barcode, a.active,
      a.defects_summary, a.client_classification, a.notes, a.imported_at, a.imported_from,
      a.intake_id, a.schema_version, a.created_at, a.updated_at, a.created_by, a.updated_by,
      a.cert_url, a.assigned_to,
      a.active AS is_active, a.make AS manufacturer, a.location_in_site AS location,
      a.parent_asset_id AS parent_id,
      a.maximo_id,
      al.job_plan_id,
      coalesce(al.dark_site_test, false) AS dark_site_test
    FROM app_data.assets a
    LEFT JOIN service.asset_local al ON al.asset_id = a.asset_id
    WHERE a.site_id IN (SELECT site_id FROM app_data.sites WHERE service_enabled = true)
  $v$;
  EXECUTE 'ALTER VIEW service.assets SET (security_invoker = on)';
  EXECUTE 'GRANT SELECT ON service.assets TO authenticated';

  ------------------------------------------------------------------------------
  -- 3. Trigger: route job_plan_id + dark_site_test to the sidecar; the rest to
  --    app_data.assets (identical mapping to 0129, incl. maximo_id).
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
        -- Soft delete: never destroy a shared canonical row. Sidecar row is left
        -- in place (cheap; FK ON DELETE CASCADE only fires on a hard delete that
        -- this path never performs).
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

        INSERT INTO service.asset_local (asset_id, tenant_id, job_plan_id, dark_site_test, updated_at)
        VALUES (OLD.asset_id, OLD.tenant_id, NEW.job_plan_id, coalesce(NEW.dark_site_test, false), now())
        ON CONFLICT (asset_id) DO UPDATE SET
          job_plan_id    = EXCLUDED.job_plan_id,
          dark_site_test = EXCLUDED.dark_site_test,
          updated_at     = now();
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

        INSERT INTO service.asset_local (asset_id, tenant_id, job_plan_id, dark_site_test, updated_at)
        VALUES (v_id, v_tenant, NEW.job_plan_id, coalesce(NEW.dark_site_test, false), now());

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
