-- 0049_sks_quotes_customer_backfill_fix.sql
--
-- Fixes the failed 0048 backfill. The 0048 DO block had swapped column refs:
--   c.name (doesn't exist) vs c.company_name (correct)
--   qc.company_name (doesn't exist) vs qc.name (correct)
-- The whole block was transactional, so nothing applied on ehow.
--
-- Join path: sks_quotes.customer_id → sks_quotes_customers.name
-- → case-insensitive match to app_data.customers.company_name
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

  -- sks_quotes_customers.name → app_data.customers.company_name
  UPDATE public.sks_quotes q
  SET canonical_customer_id = c.customer_id
  FROM public.sks_quotes_customers qc
  JOIN app_data.customers c
    ON lower(trim(c.company_name)) = lower(trim(qc.name))
  WHERE qc.id = q.customer_id
    AND q.canonical_customer_id IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'sks_quotes'
      AND indexname = 'sks_quotes_canonical_customer_id_idx'
  ) THEN
    CREATE INDEX sks_quotes_canonical_customer_id_idx
      ON public.sks_quotes (canonical_customer_id)
      WHERE canonical_customer_id IS NOT NULL;
  END IF;
END $$;
