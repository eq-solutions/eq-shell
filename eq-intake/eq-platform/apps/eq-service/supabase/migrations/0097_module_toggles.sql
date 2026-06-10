-- ============================================================
-- Migration 0097: Module toggles on tenant_settings
--
-- Per-tenant feature switches for non-core modules in the sidebar.
-- Delivers the "basic view by default + opt-in stages" model Royce
-- asked for after the sidebar simplification sweep (PRs A + B in
-- the same series).
--
-- Modules added here: Calendar, Defects, Analytics, Contract Scope.
-- (`commercial_features_enabled` from migration 0085 already gates
-- Commercials + Variations.)
--
-- Always-on core (never togglable): Dashboard, Customers, Sites,
-- Contacts, Assets, Job Plans, Maintenance, Reports, plus Search +
-- Settings + Admin. These are the platform — gating them would
-- leave a non-functional shell.
--
-- Defaults strategy (decided 2026-05-14):
--   - Existing tenants — keep all modules ON. Migration adds each
--     column with DEFAULT true so the backfill populates true, then
--     flips the DEFAULT to false in a second ALTER for future inserts.
--     No UX change for SKS / Jemena / Demo on the deploy.
--   - New tenants — minimal start. Column defaults are false, so
--     tenant_settings rows created via onboarding inherit the minimal
--     set unless the admin explicitly enables a module from
--     /admin/settings.
--
-- See commercial_features_enabled (migration 0085) for the same
-- two-step backfill-then-flip pattern.
-- ============================================================

-- Step 1 — add columns with DEFAULT true so existing rows backfill on.
ALTER TABLE public.tenant_settings
  ADD COLUMN calendar_enabled       boolean NOT NULL DEFAULT true,
  ADD COLUMN defects_enabled        boolean NOT NULL DEFAULT true,
  ADD COLUMN analytics_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN contract_scope_enabled boolean NOT NULL DEFAULT true;

-- Step 2 — flip the DEFAULT to false so NEW rows (via onboarding) start
-- minimal. Existing rows retain the true that the backfill set above.
ALTER TABLE public.tenant_settings
  ALTER COLUMN calendar_enabled       SET DEFAULT false,
  ALTER COLUMN defects_enabled        SET DEFAULT false,
  ALTER COLUMN analytics_enabled      SET DEFAULT false,
  ALTER COLUMN contract_scope_enabled SET DEFAULT false;

COMMENT ON COLUMN public.tenant_settings.calendar_enabled IS
  'When true, the Calendar sidebar entry (/calendar) is visible. Existing tenants backfilled to true by migration 0097; new tenants default false.';
COMMENT ON COLUMN public.tenant_settings.defects_enabled IS
  'When true, the Defects sidebar entry (/defects) is visible. Existing tenants backfilled to true by migration 0097; new tenants default false.';
COMMENT ON COLUMN public.tenant_settings.analytics_enabled IS
  'When true, the Analytics sidebar entry (/analytics) is visible. Existing tenants backfilled to true by migration 0097; new tenants default false.';
COMMENT ON COLUMN public.tenant_settings.contract_scope_enabled IS
  'When true, the Contract Scope sidebar entry (/contract-scope) is visible. Existing tenants backfilled to true by migration 0097; new tenants default false.';
