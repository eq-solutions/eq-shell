-- Migration: 0001_baseline
-- Target:    Per-tenant data plane (every tenant Supabase project)
-- Purpose:   Faithfully reproduce the 6 canonical-api tables (customers,
--            contacts, sites, staff, licences, jobs) from the shared
--            eq-canonical app_data schema, plus a cross-app event log
--            (canonical_events) and the migration tracking table.
--
-- The column shapes here MUST match shared eq-canonical app_data exactly
-- so that data migration (Phase 2.B.4/5) can pg_dump + restore without
-- coercion. If you change a column type here, change it on the shared
-- project first, migrate the data, then update this baseline.
--
-- Runner:    scripts/migrate-tenants.mjs reads tenant_routing and applies
--            every file in supabase/tenant-migrations/ in name order,
--            skipping ones already in app_data._eq_migrations.
--
-- RLS:       Every table has RLS enabled with a tenant-scoping policy that
--            filters on (auth.jwt() -> 'app_metadata' ->> 'tenant_id').
--            Service-role (which canonical-api uses) bypasses RLS — this
--            is defence in depth for misrouted requests, not the primary
--            isolation control.
--
-- Architecture: docs/ARCHITECTURE-V2.md "Per-tenant data plane"

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- Schema + migration tracking
-- ──────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app_data;

-- Grants. Supabase doesn't auto-grant on schemas created by MCP/migrations
-- (only on dashboard-created schemas), so we do it explicitly. Without
-- these, the service-role REST path returns "permission denied for schema
-- app_data" / "Invalid schema: app_data". Idempotent — GRANT is fine to
-- re-apply.
GRANT USAGE ON SCHEMA app_data TO service_role, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_data GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_data GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_data GRANT ALL ON FUNCTIONS TO service_role;

CREATE TABLE IF NOT EXISTS app_data._eq_migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text
);

COMMENT ON TABLE app_data._eq_migrations IS
  'Tracks tenant-plane migrations applied to this DB. Managed by scripts/migrate-tenants.mjs.';

-- ──────────────────────────────────────────────────────────────────────
-- Customers
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.customers (
  customer_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id              varchar,
  type                     text,
  company_name             varchar,
  first_name               varchar,
  last_name                varchar,
  salutation               varchar,
  abn                      varchar,
  acn                      varchar,
  street_address           varchar,
  suburb                   varchar,
  state                    text,
  postcode                 varchar,
  country                  text DEFAULT 'Australia'::text,
  postal_address           varchar,
  postal_suburb            varchar,
  postal_state             text,
  postal_postcode          varchar,
  postal_country           text,
  primary_phone            text,
  mobile_phone             text,
  alt_phone                text,
  fax                      text,
  email                    text,
  website                  varchar,
  customer_group           varchar,
  customer_profile         varchar,
  account_manager          varchar,
  currency                 varchar DEFAULT 'AUD'::varchar,
  default_quote_method     text,
  default_invoice_method   text,
  default_job_method       text,
  referred_by              text,
  notes                    text,
  active                   boolean DEFAULT true,
  created_date             date,
  imported_at              timestamptz,
  imported_from            text,
  intake_id                uuid,
  schema_version           text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_by               uuid
);

CREATE INDEX IF NOT EXISTS customers_tenant_idx        ON app_data.customers (tenant_id);
CREATE INDEX IF NOT EXISTS customers_active_idx        ON app_data.customers (tenant_id, active);
CREATE INDEX IF NOT EXISTS customers_external_idx      ON app_data.customers (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_company_idx       ON app_data.customers (tenant_id, lower(company_name));

-- ──────────────────────────────────────────────────────────────────────
-- Sites (declared before contacts + staff so FK references resolve)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.sites (
  site_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id            varchar,
  customer_id            uuid REFERENCES app_data.customers(customer_id) ON DELETE SET NULL,
  external_customer_id   varchar,
  name                   varchar NOT NULL,
  code                   varchar,
  client_name            text,
  site_type              text DEFAULT 'customer'::text,
  address_line_1         text,
  address_line_2         text,
  suburb                 text,
  state                  text,
  postcode               text,
  country                text DEFAULT 'AU'::text,
  latitude               numeric(9,6),
  longitude              numeric(9,6),
  site_contact_name      text,
  site_contact_phone     text,
  site_contact_email     text,
  induction_required     boolean DEFAULT false,
  induction_url          text,
  active                 boolean NOT NULL DEFAULT true,
  notes                  text,
  imported_at            timestamptz,
  imported_from          text,
  intake_id              uuid,
  schema_version         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_by             uuid,
  track_hours            boolean NOT NULL DEFAULT false,
  budget_hours           numeric,
  slug                   text
);

CREATE INDEX IF NOT EXISTS sites_tenant_idx       ON app_data.sites (tenant_id);
CREATE INDEX IF NOT EXISTS sites_customer_idx     ON app_data.sites (customer_id);
CREATE INDEX IF NOT EXISTS sites_active_idx       ON app_data.sites (tenant_id, active);
CREATE INDEX IF NOT EXISTS sites_external_idx     ON app_data.sites (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sites_slug_idx         ON app_data.sites (tenant_id, slug) WHERE slug IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- Contacts
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.contacts (
  contact_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  customer_id                   uuid NOT NULL REFERENCES app_data.customers(customer_id) ON DELETE CASCADE,
  external_id                   varchar,
  external_customer_id          varchar,
  company_name                  varchar,
  salutation                    varchar,
  first_name                    varchar NOT NULL,
  last_name                     varchar NOT NULL,
  email                         text,
  work_phone                    text,
  mobile_phone                  text,
  fax                           text,
  position                      varchar,
  department                    varchar,
  notes                         text,
  is_default_quote_contact      boolean,
  is_default_job_contact        boolean,
  is_default_invoice_contact    boolean,
  is_default_statement_contact  boolean,
  active                        boolean DEFAULT true,
  imported_at                   timestamptz,
  imported_from                 text,
  intake_id                     uuid,
  schema_version                text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid,
  updated_by                    uuid
);

CREATE INDEX IF NOT EXISTS contacts_tenant_idx     ON app_data.contacts (tenant_id);
CREATE INDEX IF NOT EXISTS contacts_customer_idx   ON app_data.contacts (customer_id);
CREATE INDEX IF NOT EXISTS contacts_active_idx     ON app_data.contacts (tenant_id, active);
CREATE INDEX IF NOT EXISTS contacts_email_idx      ON app_data.contacts (tenant_id, lower(email)) WHERE email IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- Staff
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.staff (
  staff_id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id                       varchar,
  first_name                        varchar NOT NULL,
  last_name                         varchar NOT NULL,
  preferred_name                    varchar,
  email                             text,
  phone                             text,
  employment_type                   text NOT NULL,
  trade                             text,
  level                             text,
  start_date                        date,
  end_date                          date,
  hourly_rate_cost                  numeric,
  hourly_rate_charge                numeric,
  home_base                         text,
  default_site_id                   uuid REFERENCES app_data.sites(site_id) ON DELETE SET NULL,
  active                            boolean NOT NULL DEFAULT true,
  notes                             text,
  imported_at                       timestamptz,
  imported_from                     text,
  intake_id                         uuid,
  schema_version                    text,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  created_by                        uuid,
  updated_by                        uuid,
  user_id                           uuid,
  notify_roster                     boolean NOT NULL DEFAULT false,
  dob_day                           smallint,
  dob_month                         smallint,
  digest_opt_in                     boolean NOT NULL DEFAULT false,
  digest_cron_schedule              text,
  tafe_day                          text,
  year_level                        smallint,
  date_of_birth                     date,
  address_street                    text,
  address_suburb                    text,
  address_state                     text,
  address_postcode                  text,
  emergency_contact_name            text,
  emergency_contact_relationship    text,
  emergency_contact_mobile          text
);

CREATE INDEX IF NOT EXISTS staff_tenant_idx        ON app_data.staff (tenant_id);
CREATE INDEX IF NOT EXISTS staff_active_idx        ON app_data.staff (tenant_id, active);
CREATE INDEX IF NOT EXISTS staff_email_idx         ON app_data.staff (tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_employment_idx    ON app_data.staff (tenant_id, employment_type);
CREATE INDEX IF NOT EXISTS staff_default_site_idx  ON app_data.staff (default_site_id);

-- ──────────────────────────────────────────────────────────────────────
-- Licences
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.licences (
  licence_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  staff_id            uuid NOT NULL REFERENCES app_data.staff(staff_id) ON DELETE CASCADE,
  external_id         varchar,
  licence_type        varchar NOT NULL,
  licence_number      varchar NOT NULL,
  issuing_authority   varchar,
  state               text,
  issue_date          date,
  expiry_date         date,
  photo_front_path    text,
  photo_back_path     text,
  notes               text,
  metadata            jsonb,
  active              boolean NOT NULL DEFAULT true,
  imported_at         timestamptz,
  imported_from       text,
  intake_id           uuid,
  schema_version      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid
);

CREATE INDEX IF NOT EXISTS licences_tenant_idx   ON app_data.licences (tenant_id);
CREATE INDEX IF NOT EXISTS licences_staff_idx    ON app_data.licences (staff_id);
CREATE INDEX IF NOT EXISTS licences_expiry_idx   ON app_data.licences (tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS licences_active_idx   ON app_data.licences (tenant_id, active);

-- ──────────────────────────────────────────────────────────────────────
-- Jobs
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.jobs (
  job_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id         text,
  customer_id         uuid REFERENCES app_data.customers(customer_id) ON DELETE SET NULL,
  site_id             uuid REFERENCES app_data.sites(site_id) ON DELETE SET NULL,
  quote_id            uuid,
  title               text,
  status              text NOT NULL DEFAULT 'active'::text,
  started_at          date,
  target_completion   date,
  intake_id           uuid,
  schema_version      text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  created_by          uuid,
  updated_by          uuid
);

CREATE INDEX IF NOT EXISTS jobs_tenant_idx     ON app_data.jobs (tenant_id);
CREATE INDEX IF NOT EXISTS jobs_customer_idx   ON app_data.jobs (customer_id);
CREATE INDEX IF NOT EXISTS jobs_site_idx       ON app_data.jobs (site_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx     ON app_data.jobs (tenant_id, status);

-- ──────────────────────────────────────────────────────────────────────
-- Canonical events (cross-app coordination — append-only)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.canonical_events (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  app_source   text NOT NULL,                    -- 'quotes' | 'field' | 'service' | 'shell' | 'cards'
  event        text NOT NULL,                    -- e.g. 'job.completed'
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_events_tenant_idx
  ON app_data.canonical_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS canonical_events_event_idx
  ON app_data.canonical_events (tenant_id, event, occurred_at DESC);

-- ──────────────────────────────────────────────────────────────────────
-- RLS — defence in depth.
-- ──────────────────────────────────────────────────────────────────────

-- Service-role needs explicit grants per table too (the default-privileges
-- ALTER above only kicks in for tables created AFTER it runs; the CREATE
-- TABLEs above were already done).
GRANT ALL ON
  app_data.customers,
  app_data.contacts,
  app_data.sites,
  app_data.staff,
  app_data.licences,
  app_data.jobs,
  app_data.canonical_events,
  app_data._eq_migrations
TO service_role;
GRANT USAGE, SELECT ON SEQUENCE app_data.canonical_events_id_seq TO service_role;

ALTER TABLE app_data.customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.sites              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.staff              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.licences           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.canonical_events   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'customers', 'contacts', 'sites', 'staff', 'licences', 'jobs', 'canonical_events'
  ]
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %I_tenant_isolation ON app_data.%I;
      CREATE POLICY %I_tenant_isolation
        ON app_data.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid)
        WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid);
    $f$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_data.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'customers', 'contacts', 'sites', 'staff', 'licences', 'jobs'
  ]
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS %I_touch_updated_at ON app_data.%I;
      CREATE TRIGGER %I_touch_updated_at
        BEFORE UPDATE ON app_data.%I
        FOR EACH ROW
        EXECUTE FUNCTION app_data.touch_updated_at();
    $f$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

COMMIT;
