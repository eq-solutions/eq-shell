-- Migration: 0039_migration_baseline_rls
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Converge app_data.migration_baseline to the canonical posture —
--            RLS ENABLED, no caller-scoped policy, service_role-only grants —
--            on tenants where the table was created (out-of-band, by the #173
--            reconciliation-view work) BEFORE RLS was added to 0037.
--
-- WHY A SEPARATE MIGRATION (not just the 0037 edit):
--   0037 was edited in place so freshly-provisioned tenants get RLS from the
--   start. But on a tenant where 0037 is ALREADY recorded in app_data._eq_migrations,
--   editing 0037 is checksum drift and the One Pipe halts before re-running it.
--   This forward migration carries the convergence so it lands regardless of
--   whether the edited 0037 re-runs. Fully idempotent.
--
-- BACKGROUND (2026-06-07): RLS on app_data.migration_baseline diverged between
--   the EQ (zaap) and SKS (ehow) tenant planes — ehow had RLS enabled to clear a
--   Supabase advisor, zaap did not (0037 never enabled it). That divergence
--   tripped the cross-tenant spine check (scripts/check-tenant-drift.mjs) and the
--   state was observed oscillating on zaap. This pins both planes to one posture
--   so there is nothing left to diverge.

-- 1. Enable RLS. service_role bypasses it; anon/authenticated have no grant and
--    therefore no row access once RLS is on. Idempotent.
ALTER TABLE app_data.migration_baseline ENABLE ROW LEVEL SECURITY;

-- 2. Drop any stray caller-scoped policy a regen-tenant-baseline pass may have
--    added (it emits <table>_tenant_isolation for any table with a tenant_id
--    column — migration_baseline has one). Removing it keeps every tenant at the
--    identical state the drift fingerprint compares: RLS on, ZERO policies.
DROP POLICY IF EXISTS migration_baseline_tenant_isolation ON app_data.migration_baseline;

-- 3. Re-assert the service-role-only grant surface (idempotent; matches 0037).
REVOKE ALL ON app_data.migration_baseline FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_data.migration_baseline TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0039_migration_baseline_rls', NULL)
  ON CONFLICT (name) DO NOTHING;
