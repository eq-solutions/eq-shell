-- Migration: 0046_staff_field_approved
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Record a manager's "approve to Field" decision ON the canonical
--            staff row, replacing the old bridge that copied approved Cards
--            profiles into the (now dead) legacy Field DB `ktmj`. Approved
--            staff already live in app_data.staff; approval is a *flag*, not a
--            second copy of the person.
--
-- WHY a flag (not presence):
--   Presence in app_data.staff means "this person exists in the tenant"; it does
--   NOT mean a manager has cleared them onto the live Field roster. Keeping an
--   explicit gate lets Cards-originated staff land as pending (field_approved =
--   false) and become roster-visible only on an explicit manager approval —
--   preserving the review step the ktmj bridge used to enforce.
--
-- WHY the grandfather backfill:
--   The column is born `false`. The existing live roster (active staff) is
--   already trusted and visible today, so enabling the Field-side gate must not
--   retroactively hide them. We flip existing ACTIVE rows to true exactly once,
--   AT COLUMN-CREATION TIME (inside the NOT EXISTS guard) so a re-run can never
--   re-approve a row that a manager later set back to pending.
--
-- Idempotent: the column add + one-time grandfather run only when the column is
-- absent; the index is IF NOT EXISTS. Safe to re-run on any plane.
--
-- The runner (scripts/migrate-tenants.mjs) is the single ledger writer; this
-- file records no ledger row of its own.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data'
      AND table_name   = 'staff'
      AND column_name  = 'field_approved'
  ) THEN
    ALTER TABLE app_data.staff
      ADD COLUMN field_approved    boolean NOT NULL DEFAULT false,
      ADD COLUMN field_approved_at timestamptz,
      ADD COLUMN field_approved_by uuid;   -- shell_control.users id (cross-project: no FK)

    -- Grandfather the existing live roster. New (post-migration) staff stay
    -- false until a manager approves. Runs once, only when the column is created.
    UPDATE app_data.staff
      SET field_approved = true,
          field_approved_at = now()
      WHERE active = true;
  END IF;
END $$;

-- Partial index: the roster read filters on field_approved = true.
CREATE INDEX IF NOT EXISTS staff_field_approved_idx
  ON app_data.staff(field_approved)
  WHERE field_approved = true;
