-- 0048_sks_quotes_canonical_customer_id.sql
--
-- Adds canonical_customer_id column to sks_quotes.
-- The backfill is in 0049 (original UPDATE had wrong column refs —
-- c.name/qc.company_name — the DO block rolled back transactionally).
--
-- Safe on planes without sks_quotes (e.g. zaap/EQ entity).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sks_quotes'
  ) THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sks_quotes'
      AND column_name = 'canonical_customer_id'
  ) THEN
    ALTER TABLE public.sks_quotes ADD COLUMN canonical_customer_id uuid;
  END IF;
END $$;
