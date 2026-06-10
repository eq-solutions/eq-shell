-- ============================================================
-- Migration 0093: Backfill expected_rcd_circuits on the demo
-- tenant's MEL-ACB-01 asset so the Year-2+ Jemena RCD overlay
-- preview has something to exercise on the demo tenant.
--
-- Battle-test follow-up from 2026-05-13: the overnight session
-- found that asset f0000000-0000-0000-0000-000000000005 on the
-- demo tenant (a0000000-0000-0000-0000-000000000001) had
-- expected_rcd_circuits = NULL, which means the createCheckAction
-- RCD-overlay block's pre-population path was never exercised
-- against the demo data. Set it to 10 so the overlay preview
-- chips show "✨ N circuits will be pre-populated from last visit"
-- when reviewers run the demo.
--
-- Idempotent: only updates rows currently NULL, so re-running this
-- (or running it against a database that has already been touched)
-- is a no-op rather than clobbering whatever value is there.
-- ============================================================

UPDATE public.assets
SET expected_rcd_circuits = 10,
    updated_at = now()
WHERE id = 'f0000000-0000-0000-0000-000000000005'
  AND tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND expected_rcd_circuits IS NULL;
