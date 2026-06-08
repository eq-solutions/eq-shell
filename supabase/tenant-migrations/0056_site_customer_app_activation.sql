-- 0056_site_customer_app_activation.sql
--
-- Adds per-app activation flags to sites and customers so operators can
-- control exactly which records appear in EQ Field vs EQ Service.
--
-- field_enabled  = record appears in Field (scheduling, dispatch, roster)
-- service_enabled = record appears in Service (CMMS, work orders, defects)
--
-- Both default to true for sites (Field and Service use sites),
-- field_enabled defaults to false for customers (customers are primarily
-- a Service concept; Field works with sites directly).
--
-- Also updates the field_sites view to filter WHERE field_enabled = true
-- so toggling the flag removes a site from Field immediately.

DO $$
BEGIN
  -- ── app_data.sites ───────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sites'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'sites'
        AND column_name = 'field_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.sites ADD COLUMN field_enabled boolean NOT NULL DEFAULT true';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'sites'
        AND column_name = 'service_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.sites ADD COLUMN service_enabled boolean NOT NULL DEFAULT true';
    END IF;
  END IF;

  -- ── app_data.customers ───────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'customers'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'customers'
        AND column_name = 'field_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.customers ADD COLUMN field_enabled boolean NOT NULL DEFAULT false';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'customers'
        AND column_name = 'service_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.customers ADD COLUMN service_enabled boolean NOT NULL DEFAULT true';
    END IF;
  END IF;

  -- ── Grant SELECT on customers to authenticated (admin UI reads) ───────────
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'customers'
  ) THEN
    EXECUTE 'GRANT SELECT ON app_data.customers TO authenticated';
  END IF;

  -- ── field_sites view — add field_enabled filter ──────────────────────────
  -- Drop if it was previously a base table (zaap ETL guard).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'field_sites'
      AND table_type = 'BASE TABLE'
  ) THEN
    EXECUTE 'DROP TABLE app_data.field_sites CASCADE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sites'
  ) THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW app_data.field_sites AS
      SELECT
        site_id           AS id,
        tenant_id,
        customer_id,
        name,
        code              AS abbr,
        address_line_1    AS address,
        suburb,
        state,
        postcode,
        site_contact_name  AS site_lead,
        site_contact_phone AS site_lead_phone,
        active,
        field_enabled,
        service_enabled,
        slug,
        notes,
        created_at,
        updated_at
      FROM app_data.sites
      WHERE field_enabled = true;
    $sql$;

    EXECUTE $sql$
      ALTER VIEW app_data.field_sites SET (security_invoker = on);
    $sql$;

    EXECUTE $sql$
      GRANT SELECT ON app_data.field_sites TO authenticated;
    $sql$;
  END IF;
END $$;
