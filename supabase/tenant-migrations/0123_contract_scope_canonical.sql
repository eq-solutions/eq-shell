-- Migration: 0123_contract_scope_canonical
-- Target:    Per-tenant data plane (every tenant Supabase project, app_data schema)
-- Purpose:   First Service WORKFLOW entity to go canonical. Adds
--            app_data.contract_scopes — a customer's commercial scope-of-work
--            lines (DELTA ELCOM 'SCS' tab + per-JP tabs), carrying the per-cycle
--            / per-year commercial JSONB. Column shape matches the registered
--            eq-intake schema (schemas/contract_scope.schema.json, x-eq-table =
--            contract_scopes) plus the canonical entity template. Also adds the
--            security_invoker read-bridge app_data.service_contract_scopes for
--            EQ Service, and reconciles the missing authenticated SELECT grant on
--            app_data.assets (parity with customers/sites — fixes the 403 the
--            service spine view hit for Bearer sessions).
-- Idempotent: yes (CREATE … IF NOT EXISTS, DROP/CREATE POLICY, CREATE OR REPLACE VIEW,
--             guarded GRANT). Safe to re-run; lands on tenants at different states.
-- Design:    eq-context/eq/canonical-readiness/contract-scope-canonical-design-2026-06-15.md
--
-- Locked design decisions (Royce, 2026-06-15):
--   D1  ONE `lifecycle_status` column (draft/staged/committed/locked/archived),
--       collapsing the legacy status + period_status. (The Intake schema's `status`
--       enum is widened to match in the Phase-2 skill work.)
--   D2  job-plan linkage is `jp_code` TEXT only — job_plans stays Service-local, not canonical.
--   D3  `service_contract` parent deferred — `service_contract_id` column present
--       (forward-compat, nullable) but carries NO FK yet (no parent table exists).
--   D-FY `financial_year` normalised to 'YYYY-YYYY' (CHECK enforces the format).
--
-- Writes land via the Intake commit RPC (service_role); EQ Service reads the bridge
-- view. authenticated gets SELECT only — edits will go through SECURITY DEFINER RPCs
-- in a later phase, never direct authenticated writes.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- app_data.contract_scopes
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.contract_scopes (
  scope_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id              varchar,

  -- relationships: customer required; site/asset optional pins; contract parent deferred (D3)
  customer_id              uuid NOT NULL REFERENCES app_data.customers(customer_id) ON DELETE CASCADE,
  service_contract_id      uuid,                                                          -- D3: no FK yet (parent not modelled)
  site_id                  uuid REFERENCES app_data.sites(site_id)   ON DELETE SET NULL,  -- NULL = all customer sites
  asset_id                 uuid REFERENCES app_data.assets(asset_id) ON DELETE SET NULL,  -- optional asset-level pin

  -- period / classification
  financial_year           text NOT NULL DEFAULT '2025-2026'
                             CHECK (financial_year ~ '^[0-9]{4}-[0-9]{4}$'),              -- D-FY
  scope_item               text NOT NULL,
  is_included              boolean NOT NULL DEFAULT true,
  billing_basis            text NOT NULL DEFAULT 'fixed'
                             CHECK (billing_basis IN ('fixed', 'ad_hoc')),
  lifecycle_status         text NOT NULL DEFAULT 'committed'
                             CHECK (lifecycle_status IN ('draft', 'staged', 'committed', 'locked', 'archived')),  -- D1
  jp_code                  text,                                                          -- D2: text linkage to Service-local job_plans
  notes                    text,

  -- structured commercial fields (mirror the Intake contract_scope schema)
  asset_qty                integer       CHECK (asset_qty IS NULL OR asset_qty >= 0),
  intervals_text           text,
  cycle_costs              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-asset cost per cycle
  year_totals              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-year base $ (BEFORE CPI)
  due_years                jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-year asset count due
  labour_hours_per_asset   jsonb NOT NULL DEFAULT '{}'::jsonb,
  unit_rate_per_asset      numeric(12,2) CHECK (unit_rate_per_asset IS NULL OR unit_rate_per_asset >= 0),
  has_bundled_scope        boolean NOT NULL DEFAULT false,
  commercial_gap           boolean NOT NULL DEFAULT false,

  -- import audit trail
  source_workbook          text,
  source_sheet             text,
  source_row               integer,
  source_import_id         uuid,

  -- canonical entity template (provenance + soft-delete + audit)
  active                   boolean NOT NULL DEFAULT true,
  imported_at              timestamptz,
  imported_from            text,
  intake_id                uuid,
  schema_version           text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_by               uuid
);

CREATE INDEX IF NOT EXISTS contract_scopes_tenant_idx        ON app_data.contract_scopes (tenant_id);
CREATE INDEX IF NOT EXISTS contract_scopes_external_idx      ON app_data.contract_scopes (tenant_id, external_id)        WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_scopes_customer_fy_idx   ON app_data.contract_scopes (tenant_id, customer_id, financial_year);
CREATE INDEX IF NOT EXISTS contract_scopes_site_idx          ON app_data.contract_scopes (site_id)                       WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_scopes_asset_idx         ON app_data.contract_scopes (asset_id)                      WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_scopes_contract_idx      ON app_data.contract_scopes (service_contract_id)           WHERE service_contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_scopes_jp_idx            ON app_data.contract_scopes (tenant_id, jp_code)            WHERE jp_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_scopes_import_idx        ON app_data.contract_scopes (source_import_id)              WHERE source_import_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_scopes_active_idx        ON app_data.contract_scopes (tenant_id, active);

COMMENT ON TABLE app_data.contract_scopes IS
  'Canonical contract-scope lines (commercial SoW). First Service workflow entity in canonical. Matches eq-intake contract_scope.schema.json. Written via the Intake commit RPC; read by EQ Service via app_data.service_contract_scopes.';

-- ──────────────────────────────────────────────────────────────────────
-- Grants + RLS (read-only for authenticated; writes via service_role / RPCs)
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE app_data.contract_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_scopes_tenant_isolation ON app_data.contract_scopes;
CREATE POLICY contract_scopes_tenant_isolation ON app_data.contract_scopes
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

REVOKE ALL    ON app_data.contract_scopes FROM anon, authenticated;
GRANT  SELECT ON app_data.contract_scopes TO authenticated;
GRANT  ALL    ON app_data.contract_scopes TO service_role;

-- updated_at trigger (reuses app_data.touch_updated_at() from 0001_baseline).
DROP TRIGGER IF EXISTS contract_scopes_touch_updated_at ON app_data.contract_scopes;
CREATE TRIGGER contract_scopes_touch_updated_at
  BEFORE UPDATE ON app_data.contract_scopes
  FOR EACH ROW
  EXECUTE FUNCTION app_data.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- Read bridge for EQ Service (security_invoker → base-table RLS applies)
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW app_data.service_contract_scopes AS
  SELECT
    scope_id AS id,
    scope_id,
    tenant_id,
    customer_id,
    service_contract_id,
    site_id,
    asset_id,
    financial_year,
    scope_item,
    is_included,
    billing_basis,
    lifecycle_status,
    jp_code,
    notes,
    asset_qty,
    intervals_text,
    cycle_costs,
    year_totals,
    due_years,
    labour_hours_per_asset,
    unit_rate_per_asset,
    has_bundled_scope,
    commercial_gap,
    source_workbook,
    source_sheet,
    source_row,
    source_import_id,
    active,
    imported_at,
    imported_from,
    created_at,
    updated_at
  FROM app_data.contract_scopes;

ALTER VIEW app_data.service_contract_scopes SET (security_invoker = on);
GRANT SELECT ON app_data.service_contract_scopes TO authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- Reconcile: app_data.assets was missing the authenticated SELECT grant that
-- customers/sites already carry, so the security_invoker spine view returned
-- "permission denied for table assets" for Bearer (authenticated) sessions.
-- RLS on assets is unchanged (identical tenant-isolation policy), so reads stay
-- tenant-scoped. Guarded — assets exists on every tenant from 0002, but be safe.
-- ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'assets'
  ) THEN
    EXECUTE 'GRANT SELECT ON app_data.assets TO authenticated';
  END IF;
END $$;

COMMIT;
