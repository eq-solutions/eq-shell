-- Migration: 2026_05_24c_drop_shared_app_data
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only — not tenant DBs
-- Purpose:   Final step of the per-tenant data-plane cutover (Phase 2.B.7).
--            Removes the shared app_data schema entirely. After this,
--            every read/write to operational entities goes through the
--            per-tenant data plane (eq-canonical-internal, sks-canonical)
--            via the tenant-routing Netlify functions.
--
-- Prereqs (all verified before applying):
--   - Phase 2.B.6 complete (all 5 intake modules live)
--   - Phase 2.B.6.5 complete (commit-canonical fetches /intake-commit)
--   - Jobs module deleted from src/ (same PR as this migration)
--   - Grep audit: ZERO direct `.schema('app_data')` callers in src/ or
--     netlify/functions/ that aren't using the tenant client
--   - Cross-schema FK audit: ZERO foreign keys from other schemas INTO
--     app_data (verified via pg_constraint join on 2026-05-24)
--
-- Before-state (at audit time): 43 tables, 1 function. The function is
-- public.eq_intake_commit_batch (the old shared dispatcher) — superseded
-- by /.netlify/functions/intake-commit + the per-module RPCs on tenant
-- DBs. Dropping app_data CASCADE will leave the function in place
-- (it's in public, not app_data); the function will just fail at call
-- time if anyone tries it. We drop it explicitly too as a separate step.
--
-- Rollback: snapshot restore via Supabase dashboard (PITR available on
-- Pro tier). No SQL rollback path — this is intentional finality.

DROP SCHEMA app_data CASCADE;

-- Retire the old shared dispatcher. It would otherwise still exist
-- pointing at now-missing tables.
DROP FUNCTION IF EXISTS public.eq_intake_commit_batch(uuid, uuid, text, jsonb, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.eq_intake_commit_batch(uuid, uuid, text, jsonb);
