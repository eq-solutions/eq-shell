-- Migration: 0039_staff_field_status
-- Target:    Per-tenant data plane (app_data schema)
-- Purpose:   Add the tenant-plane gate for the Cards -> Field "promotion" seam.
--            field_status marks whether a staff record is a live, dispatchable
--            Field resource ('active'), still awaiting an admin's "Add to Field"
--            decision ('pending'), or declined ('rejected').
--
-- WHY a column on app_data.staff (decision D-A, cards-field-promotion-sprint):
--   The promotion gate MUST live in the tenant data plane. The audit row in
--   shell_control.cards_field_approvals lives on the CONTROL plane (jvkn), and
--   Field reads its own tenant plane (e.g. ehowg) — it cannot cheaply join
--   across DBs. So Field filters `field_status='active'` here; the control-plane
--   approval row remains the who/when AUDIT, not the gate.
--
-- This replaces the cross-DB blind-INSERT in cards-approve-staff (which wrote a
-- person into the Field DEMO project) with a state-flip on the row that already
-- exists in this table. Promotion becomes UPDATE ... SET field_status, so the
-- duplicate-person risk dissolves (no INSERT). See docs/cards-field-promotion-spec.md.
--
-- Backfill: rows imported FROM Field ('eq-solves-field') are already Field
--   people -> 'active'. Everything else defaults to 'pending' (a net-new Cards
--   onboard awaiting review).
--
-- Runner:    scripts/migrate-tenants.mjs applies every file in name order,
--            skipping ones already in app_data._eq_migrations.
--
-- NOT YET APPLIED — author-on-branch. Applies in F1 (the gated Field-unification
--   step) to BOTH tenant planes (ehowg + zaap) in the same window as the Field
--   entity registration, so Field's first read sees a populated column. Do NOT
--   apply standalone — the consuming code (refactored cards-approve-staff +
--   Field's people query) lands in the same change.

BEGIN;

ALTER TABLE app_data.staff
  ADD COLUMN IF NOT EXISTS field_status text NOT NULL DEFAULT 'pending';

COMMENT ON COLUMN app_data.staff.field_status IS
  'Cards->Field promotion gate. pending = net-new Cards onboard awaiting an admin "Add to Field"; active = live dispatchable Field resource (Field reads WHERE field_status=''active''); rejected = declined. Set by cards-approve-staff via state-flip. Added 0039.';

-- Allowed values. ADD CONSTRAINT has no IF NOT EXISTS, so guard it.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_field_status_chk'
      AND conrelid = 'app_data.staff'::regclass
  ) THEN
    ALTER TABLE app_data.staff
      ADD CONSTRAINT staff_field_status_chk
      CHECK (field_status IN ('pending', 'active', 'rejected'));
  END IF;
END $$;

-- Back-migrated Field people are already resources.
UPDATE app_data.staff
  SET field_status = 'active'
  WHERE imported_from = 'eq-solves-field'
    AND field_status = 'pending';

-- Field's people query filters on this; the review queue scans 'pending'.
CREATE INDEX IF NOT EXISTS staff_field_status_idx
  ON app_data.staff (tenant_id, field_status);

-- Single canonical read-path for Field (decision D-A, steelmanned): Field
-- consumers (Shell service-role functions) SELECT from this view, never from
-- app_data.staff directly, so no surface can forget the field_status filter and
-- leak a 'pending' person into the dispatch pool. The gate IS the surface.
-- SELECT * is expanded at creation — re-run this migration to refresh after a
-- staff-column change.
CREATE OR REPLACE VIEW app_data.field_people AS
  SELECT * FROM app_data.staff WHERE field_status = 'active';

COMMENT ON VIEW app_data.field_people IS
  'Canonical Field people = staff WHERE field_status=''active''. Field reads HERE, never app_data.staff directly, so the promotion gate cannot be bypassed. Added 0039.';

REVOKE ALL ON app_data.field_people FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app_data.field_people TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0039_staff_field_status', NULL)
  ON CONFLICT (name) DO NOTHING;

COMMIT;
