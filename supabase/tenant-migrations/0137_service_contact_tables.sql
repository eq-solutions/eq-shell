-- 0137_service_contact_tables.sql
-- Target:  Per-tenant data plane (ehow + zaap). No-op on the control plane.
-- Applied: VIA THE ONE PIPE ONLY (tenant-migrate.yml, Royce-dispatched).
--          Do NOT apply by hand.
--
-- Purpose: Create service.customer_contacts and service.site_contacts —
--   the junction tables EQ Service uses for contact management.
--   These were absent from all tenant DBs (service.contacts exists but is a
--   legacy EQ Field import table with a different schema). The app has
--   referenced these tables since the contact-management sprint but they
--   were never migrated, leaving all /contacts, /customers, /sites contact
--   features broken in production.
--
-- customer_contacts: one row per contact–customer link. is_primary marks the
--   default contact for that customer. One real-world person can appear as
--   separate rows across different customers (dedup tooling is a UI concern).
--
-- site_contacts: same pattern for sites.
--
-- Backfill: existing service.contacts rows (341 on ehow) are back-ported into
--   customer_contacts via an inner join on service.customers. Only rows with a
--   matching customer and a non-empty name are included. Idempotent: re-running
--   skips rows that already exist by name+customer match.
--
-- RLS: JWT app_metadata.tenant_id — same pattern as service.asset_local (0130).

DO $$
BEGIN
  -- Guard: control plane has no service.customers. Skip silently.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'service' AND table_name = 'customers'
  ) THEN
    RAISE NOTICE '0137: service.customers absent — control plane, skipping.';
    RETURN;
  END IF;

  -- Schema and usage grant (idempotent — prior migrations already ran this,
  -- but safe to repeat).
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS service';
  EXECUTE 'GRANT USAGE ON SCHEMA service TO authenticated';

  --------------------------------------------------------------------------
  -- 1. service.customer_contacts
  --------------------------------------------------------------------------
  EXECUTE $sql$
    CREATE TABLE IF NOT EXISTS service.customer_contacts (
      id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid        NOT NULL,
      customer_id uuid        NOT NULL,
      name        text        NOT NULL,
      role        text,
      email       text,
      phone       text,
      is_primary  boolean     NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  $sql$;

  EXECUTE 'ALTER TABLE service.customer_contacts ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS cc_tenant ON service.customer_contacts';
  EXECUTE $pol$
    CREATE POLICY cc_tenant ON service.customer_contacts
      FOR ALL TO authenticated
      USING      (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
  $pol$;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON service.customer_contacts TO authenticated';
  EXECUTE 'GRANT ALL ON service.customer_contacts TO service_role';

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cc_customer_id ON service.customer_contacts (customer_id)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cc_tenant_id   ON service.customer_contacts (tenant_id)';

  --------------------------------------------------------------------------
  -- 2. service.site_contacts
  --------------------------------------------------------------------------
  EXECUTE $sql$
    CREATE TABLE IF NOT EXISTS service.site_contacts (
      id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid        NOT NULL,
      site_id     uuid        NOT NULL,
      name        text        NOT NULL,
      role        text,
      email       text,
      phone       text,
      is_primary  boolean     NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  $sql$;

  EXECUTE 'ALTER TABLE service.site_contacts ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS sc_tenant ON service.site_contacts';
  EXECUTE $pol$
    CREATE POLICY sc_tenant ON service.site_contacts
      FOR ALL TO authenticated
      USING      (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
  $pol$;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON service.site_contacts TO authenticated';
  EXECUTE 'GRANT ALL ON service.site_contacts TO service_role';

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sc_site_id   ON service.site_contacts (site_id)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sc_tenant_id ON service.site_contacts (tenant_id)';

  --------------------------------------------------------------------------
  -- 3. Backfill customer_contacts from service.contacts (legacy import).
  --    contacts.customer_id = customers.customer_id (verified same UUID).
  --    Skips orphaned contacts (no matching customer) and blank names.
  --    NOT EXISTS guard makes this idempotent on re-run.
  --------------------------------------------------------------------------
  INSERT INTO service.customer_contacts (
    id, tenant_id, customer_id, name, role, email, phone, is_primary, created_at
  )
  SELECT
    gen_random_uuid(),
    c.tenant_id,
    c.customer_id,
    TRIM(
      COALESCE(c.first_name, '') ||
      CASE WHEN c.first_name IS NOT NULL AND c.last_name IS NOT NULL THEN ' ' ELSE '' END ||
      COALESCE(c.last_name, '')
    ),
    c.position,
    c.email,
    COALESCE(c.work_phone, c.mobile_phone),
    COALESCE(c.is_default_job_contact, false) OR COALESCE(c.is_default_quote_contact, false),
    COALESCE(c.created_at, now())
  FROM service.contacts c
  INNER JOIN service.customers cu ON cu.customer_id = c.customer_id
  WHERE c.tenant_id IS NOT NULL
    AND TRIM(COALESCE(c.first_name, '') || COALESCE(c.last_name, '')) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM service.customer_contacts cc
      WHERE cc.customer_id = c.customer_id
        AND cc.tenant_id   = c.tenant_id
        AND cc.name = TRIM(
          COALESCE(c.first_name, '') ||
          CASE WHEN c.first_name IS NOT NULL AND c.last_name IS NOT NULL THEN ' ' ELSE '' END ||
          COALESCE(c.last_name, '')
        )
    );

  RAISE NOTICE '0137: service.customer_contacts and service.site_contacts created. Backfill complete.';

END $$;
