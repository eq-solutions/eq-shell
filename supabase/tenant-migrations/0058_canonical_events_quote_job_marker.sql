-- 0058_canonical_events_quote_job_marker.sql
--
-- Adds processed_by_quote_job to app_data.canonical_events — the outbox
-- marker for the quote-job-consumer-scheduler Netlify function (WS5).
--
-- The column was applied directly to the SKS tenant (out-of-band) during
-- the cross-app-linkage sprint (2026-06-09), causing SPINE drift on the
-- CI check. This migration brings core (and any future tenants) in sync.
--
-- Usage:
--   The consumer reads WHERE processed_by_quote_job IS NOT TRUE and flips
--   the column to true once the corresponding app_data.jobs row is created
--   (or confirmed to already exist). Idempotent — safe to re-run.
--
-- The partial index (IS NOT TRUE covers both FALSE and NULL) keeps the
-- consumer scan O(unprocessed) rather than O(all canonical_events).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data'
      AND table_name   = 'canonical_events'
      AND column_name  = 'processed_by_quote_job'
  ) THEN
    ALTER TABLE app_data.canonical_events
      ADD COLUMN processed_by_quote_job BOOLEAN DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ce_unprocessed_quote_job
  ON app_data.canonical_events (tenant_id, event, occurred_at)
  WHERE processed_by_quote_job IS NOT TRUE;
