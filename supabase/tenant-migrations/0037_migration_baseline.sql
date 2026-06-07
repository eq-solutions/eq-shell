-- Migration: 0037_migration_baseline
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Holds the "expected" row count per migrated entity, written by the
--            migration scripts as they load each entity, so the admin/migration
--            reconciliation view can diff expected-vs-landed.
--
-- Lives on the tenant data plane (not the control plane) so the migration
-- scripts can record expected_count atomically — in the same transaction as the
-- data load they're already running. `entity` is keyed on the app_data table
-- name (e.g. 'customers', 'staff'), matching eq_migration_counts' keys.
--
-- Contract for migration scripts: docs/migration-baseline-contract.md.
--
-- RLS: enabled, with NO caller-scoped policy. service_role bypasses RLS and is
-- the only grantee; there is no anon/authenticated path. This matches every
-- other app_data table (all RLS=on) and the posture already applied to the SKS
-- (ehow) plane. Enabling here keeps fresh-provisioned tenants consistent from
-- the start; 0039_migration_baseline_rls converges tenants where this table was
-- created before RLS was added.

CREATE TABLE IF NOT EXISTS app_data.migration_baseline (
  tenant_id      uuid        NOT NULL,
  entity         text        NOT NULL,
  expected_count bigint      NOT NULL CHECK (expected_count >= 0),
  source_note    text,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity)
);

COMMENT ON TABLE app_data.migration_baseline IS
  'Expected per-entity row counts for a tenant migration, keyed on the app_data table name. Written by migration scripts (expected = legacy source count) in the same transaction as the load. Read by the admin/migration reconciliation view, diffed against eq_migration_counts (landed).';

-- tenant_id deliberately has no FK: the tenants table lives on the control
-- plane, not here — same convention as every other app_data table.
CREATE INDEX IF NOT EXISTS migration_baseline_tenant ON app_data.migration_baseline(tenant_id);

-- Read by the reconcile function (service-role, app_data client) and written by
-- migration scripts (service-role). No browser path → no anon/authenticated grant.
REVOKE ALL ON app_data.migration_baseline FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_data.migration_baseline TO service_role;

-- RLS on, no caller policy: service_role bypasses RLS; anon/authenticated have no
-- grant and (with RLS enabled) no row access. Idempotent.
ALTER TABLE app_data.migration_baseline ENABLE ROW LEVEL SECURITY;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0037_migration_baseline', NULL)
  ON CONFLICT (name) DO NOTHING;
