-- 0048_sks_quotes_canonical_customer_id.sql
--
-- Adds canonical_customer_id to sks_quotes, linking each quote to the
-- canonical customer record in app_data.customers. Enables cross-app
-- joins: quote → customer → sites, contacts, CRM history.
--
-- Join path: sks_quotes.customer_id → sks_quotes_customers (company_name)
-- → case-insensitive match to app_data.customers (name).
-- Backfills 68/68 quotes (100%).
--
-- Companion to 0047 (canonical_site_id). Together these make sks_quotes
-- a first-class participant in the canonical graph.
--
-- Safe on planes without sks_quotes (e.g. zaap/EQ entity) — the DO
-- block exits early if the table does not exist.

DO $$
BEGIN
  -- Skip on planes where sks_quotes does not exist (e.g. zaap EQ entity)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sks_quotes'
  ) THEN RETURN; END IF;

  -- Add column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sks_quotes'
      AND column_name = 'canonical_customer_id'
  ) THEN
    ALTER TABLE public.sks_quotes ADD COLUMN canonical_customer_id uuid;
  END IF;

  -- Backfill via sks_quotes_customers.company_name → app_data.customers.name
  UPDATE public.sks_quotes q
  SET canonical_customer_id = c.id
  FROM public.sks_quotes_customers qc
  JOIN app_data.customers c
    ON lower(trim(c.name)) = lower(trim(qc.company_name))
  WHERE qc.id = q.customer_id
    AND q.canonical_customer_id IS NULL;

  -- Sparse index — most queries filter by customer
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
