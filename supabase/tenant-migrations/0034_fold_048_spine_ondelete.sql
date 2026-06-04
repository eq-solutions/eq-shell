-- =============================================================================
-- Migration 0034: Fold migration 048 (spine ON-DELETE normalisation) into the lineage
--
-- Step 5 tail of schema governance (SCHEMA-GOVERNANCE.md). The ON-DELETE
-- normalisation was authored OUT-OF-BAND in eq-intake (sql/048) and applied to
-- the existing tenants, but never entered the eq-shell spine — so a freshly
-- provisioned tenant would be born with the UNSAFE (CASCADE) semantics. This
-- folds it in so every tenant, existing and future, is uniform.
--
-- Two spine-parent edges are made RESTRICT so deleting a spine row cannot
-- silently destroy dependent compliance/spine records:
--
--   1. licences.staff_id   -> staff      : CASCADE -> RESTRICT
--        A staff delete must not CASCADE-destroy that worker's licence history
--        (the compliance record "who can work where" depends on).
--   2. contacts.customer_id -> customers  : CASCADE -> RESTRICT
--        A customer delete must not CASCADE-destroy their contact records.
--
-- Verified read-only 2026-06-03: both live tenants (zaap, ehow) already carry
-- these as RESTRICT under the canonical `_fkey` names — so this is a no-op on
-- them (DROP the existing RESTRICT fkey, re-ADD as RESTRICT) and exists to put
-- the intent in the spine for fresh tenants. Re-validates against existing rows
-- (contacts ~hundreds, licences ~few) under a brief ACCESS EXCLUSIVE lock; the
-- data already satisfies the constraint, so re-validation passes.
--
-- NOT touched (faithful to 048): junction CASCADE on contact_customer_links, the
-- SET NULL edges (non-destructive), and already-safe NO ACTION/RESTRICT edges.
-- =============================================================================

BEGIN;

-- 1. licences.staff_id : -> RESTRICT
ALTER TABLE app_data.licences DROP CONSTRAINT IF EXISTS licences_staff_id_fkey;
ALTER TABLE app_data.licences
  ADD CONSTRAINT licences_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES app_data.staff(staff_id) ON DELETE RESTRICT;

-- 2. contacts.customer_id : -> RESTRICT
ALTER TABLE app_data.contacts DROP CONSTRAINT IF EXISTS contacts_customer_id_fkey;
ALTER TABLE app_data.contacts
  ADD CONSTRAINT contacts_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES app_data.customers(customer_id) ON DELETE RESTRICT;

COMMIT;
