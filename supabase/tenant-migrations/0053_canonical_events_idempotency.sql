-- 0053_canonical_events_idempotency.sql
--
-- Adds idempotency_key to app_data.canonical_events with a unique partial
-- index (NULLs excluded). Allows callers to INSERT ... ON CONFLICT DO NOTHING
-- so retried event emissions are exactly-once rather than duplicate.
--
-- Existing rows (idempotency_key IS NULL) are unaffected — the partial index
-- excludes NULLs so they don't collide.
--
-- Usage pattern:
--   INSERT INTO app_data.canonical_events (tenant_id, app_source, event, payload, idempotency_key)
--   VALUES (...)
--   ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data'
      AND table_name   = 'canonical_events'
      AND column_name  = 'idempotency_key'
  ) THEN
    ALTER TABLE app_data.canonical_events ADD COLUMN idempotency_key TEXT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS canonical_events_idempotency_key_idx
  ON app_data.canonical_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
