-- =============================================================================
-- Migration 0032: Canonical column union (Cards links + safety-record status)
--
-- Step 4 of schema governance (SCHEMA-GOVERNANCE.md). Brings every tenant to the
-- canonical UNION at the column level — additive only, zero data loss.
--
-- DIRECTION (verified read-only against both live tenants 2026-06-03 — the
-- original planning memo had this BACKWARDS): these six columns + the
-- safety_record_status enum exist on the SKS tenant (ehow) and are MISSING on
-- the EQ tenant (zaap). This migration adds them everywhere they are absent;
-- it is a no-op on tenants that already have them (ADD COLUMN IF NOT EXISTS).
--
--   licences.cards_credential_id   uuid          — EQ Cards credential link
--   licences.confirmed_at          timestamptz   — Cards compliance confirmation
--   licences.confirmed_by          text          — who confirmed
--   staff.cards_worker_id          uuid          — Cards worker link
--   prestart_checks.status         safety_record_status NOT NULL DEFAULT 'draft'
--   toolbox_talks.status           safety_record_status NOT NULL DEFAULT 'draft'
--
-- The NOT NULL DEFAULT 'draft' backfills any existing rows on adoption — safe.
-- =============================================================================

BEGIN;

-- ── Enum type (public schema, matching the SKS tenant's existing location) ────
-- CREATE TYPE has no IF NOT EXISTS; guard so the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'safety_record_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.safety_record_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
  END IF;
END$$;

-- ── EQ Cards links on licences / staff ───────────────────────────────────────
ALTER TABLE app_data.licences
  ADD COLUMN IF NOT EXISTS cards_credential_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by        text;

ALTER TABLE app_data.staff
  ADD COLUMN IF NOT EXISTS cards_worker_id uuid;

-- ── Draft/submitted state on safety records ──────────────────────────────────
ALTER TABLE app_data.prestart_checks
  ADD COLUMN IF NOT EXISTS status public.safety_record_status NOT NULL DEFAULT 'draft';

ALTER TABLE app_data.toolbox_talks
  ADD COLUMN IF NOT EXISTS status public.safety_record_status NOT NULL DEFAULT 'draft';

COMMIT;
