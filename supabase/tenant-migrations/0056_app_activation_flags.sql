-- 0056_app_activation_flags.sql
--
-- Adds field_enabled and service_enabled flags to app_data.sites and
-- app_data.customers. These control which records appear in EQ Field and
-- EQ Service respectively, managed via the /admin/data-activation page.
--
-- Defaults:
--   sites.field_enabled    = true  (existing sites visible in Field by default)
--   sites.service_enabled  = true  (existing sites visible in Service by default)
--   customers.field_enabled    = false (customers opt-in to Field)
--   customers.service_enabled  = true  (existing customers visible in Service by default)
--
-- Grants SELECT on customers to authenticated (sites already granted in 0054).

DO $$
BEGIN
  -- ── app_data.sites ──────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'sites'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'sites'
      AND column_name = 'field_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.sites ADD COLUMN field_enabled BOOLEAN NOT NULL DEFAULT true';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'sites'
      AND column_name = 'service_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.sites ADD COLUMN service_enabled BOOLEAN NOT NULL DEFAULT true';
    END IF;
  END IF;

  -- ── app_data.customers ──────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'customers'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'customers'
      AND column_name = 'field_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.customers ADD COLUMN field_enabled BOOLEAN NOT NULL DEFAULT false';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_data' AND table_name = 'customers'
      AND column_name = 'service_enabled'
    ) THEN
      EXECUTE 'ALTER TABLE app_data.customers ADD COLUMN service_enabled BOOLEAN NOT NULL DEFAULT true';
    END IF;

    -- Ensure authenticated role can SELECT customers (sites already granted in 0054)
    EXECUTE 'GRANT SELECT ON app_data.customers TO authenticated';
  END IF;
END $$;
