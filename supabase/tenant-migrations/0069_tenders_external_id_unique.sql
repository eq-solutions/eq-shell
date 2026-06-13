-- Migration: 0069_tenders_external_id_unique
-- Target:    Per-tenant data plane (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Unique constraint on app_data.tenders(external_id) so EQ Quotes
--            can upsert on conflict without a race condition.
--            Also ensures backfill idempotency when replayed.
--
--            Safe on zaap (EQ tenant) — tenders table exists there but is empty.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenders_external_id_key'
      AND conrelid = 'app_data.tenders'::regclass
  ) THEN
    ALTER TABLE app_data.tenders ADD CONSTRAINT tenders_external_id_key UNIQUE (external_id);
  END IF;
END $$;
