-- Adds licence-review audit columns to shell_control.cards_field_approvals.
--
-- Populated by the licence review modal (StaffPage) via cards-approve-staff.ts:
-- when an admin reviews a worker's submitted licences card-by-card before adding
-- them to the roster, each Sighted/Flag decision is recorded here.
--
-- Control plane (eq-canonical / jvkn), shell_control schema — NOT a tenant
-- app_data migration, so no _eq_migrations ledger row.
--
-- Applied live via Supabase MCP 2026-06-27; this file records it for repo parity.

ALTER TABLE shell_control.cards_field_approvals
  ADD COLUMN IF NOT EXISTS licence_verifications jsonb,
  ADD COLUMN IF NOT EXISTS licences_verified_at  timestamptz;

COMMENT ON COLUMN shell_control.cards_field_approvals.licence_verifications IS
  'Array of {licence_id, status: sighted|flagged, comment} reviewed by admin before approval';
COMMENT ON COLUMN shell_control.cards_field_approvals.licences_verified_at IS
  'Timestamp when admin completed the licence review step';
