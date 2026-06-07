-- Migration: 0040_assets_assigned_to
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Give plant & equipment a custodian — the staff member currently
--            responsible for an item. Drives the "Assigned to" column and the
--            Group-by-person rollup in the Plant & Equipment shell module.
--
-- WHY a nullable FK with ON DELETE SET NULL:
--   Custody is optional (most gear is location-bound, not person-bound) so the
--   column is nullable. When a staff member is removed, their items must not be
--   deleted — they revert to unassigned, hence SET NULL (not CASCADE).
--
-- Idempotent throughout: ADD COLUMN IF NOT EXISTS, a catalog-guarded constraint
-- add, and CREATE INDEX IF NOT EXISTS. Safe to re-run on any plane.
--
-- The runner (scripts/migrate-tenants.mjs) is the single ledger writer; this
-- file deliberately records no ledger row of its own (the runner does that on
-- apply, under the full filename).

-- 1. The custodian column. Nullable — unassigned is the default state.
ALTER TABLE app_data.assets
  ADD COLUMN IF NOT EXISTS assigned_to uuid;

-- 2. FK → app_data.staff(staff_id), ON DELETE SET NULL. Postgres has no
--    ADD CONSTRAINT IF NOT EXISTS, so guard on the catalog.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_assigned_to_fkey'
      AND conrelid = 'app_data.assets'::regclass
  ) THEN
    ALTER TABLE app_data.assets
      ADD CONSTRAINT assets_assigned_to_fkey
      FOREIGN KEY (assigned_to)
      REFERENCES app_data.staff(staff_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Index the FK so the Group-by-person rollup and custodian filters stay fast.
CREATE INDEX IF NOT EXISTS assets_assigned_to_idx
  ON app_data.assets(assigned_to);
