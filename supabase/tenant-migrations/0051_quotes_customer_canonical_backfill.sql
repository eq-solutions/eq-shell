-- 0051_quotes_customer_canonical_backfill.sql
--
-- Links sks_quotes_customers.canonical_id → app_data.customers.customer_id
-- by company name match (case-insensitive, trimmed).
--
-- Background: canonical_id previously stored sks_customers.id (the Quotes
-- mirror table — effectively a self-reference since both tables share the
-- same UUID). This corrects all rows to point to the real canonical record.
--
-- Unique index dropped first: sks_quotes_customers_canonical_id_unique was
-- created with a UNIQUE constraint which is wrong for a many-to-one link
-- (multiple Quotes customer rows can legitimately reference the same canonical
-- company — e.g. the same company entered twice, or name variants). A partial
-- non-unique index (idx_sks_quotes_customers_canonical_id) already exists for
-- lookup performance; the unique constraint is incorrect and is removed here.
--
-- Result after: ~519/520 rows linked. The 1 unmatched (no name match in
-- app_data.customers) stays NULL — it is a Quotes-only prospect with no
-- operational presence in canonical.
--
-- Strategy: correlated subquery with ORDER BY created_at / LIMIT 1 handles
-- the rare case of duplicate company names in app_data — takes the oldest
-- canonical record (most likely the authoritative one).
--
-- Safe: idempotent WHERE clause means re-running is harmless. Only touches
-- planes that have both public.sks_quotes_customers and app_data.customers.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sks_quotes_customers'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'customers'
  ) THEN
    RETURN;
  END IF;

  -- Drop the incorrect unique index if it still exists.
  -- canonical_id is a many-to-one FK — uniqueness would prevent multiple
  -- Quotes customer rows from linking to the same canonical company.
  DROP INDEX IF EXISTS public.sks_quotes_customers_canonical_id_unique;

  -- Update all rows that have a canonical name match (covers both the 28
  -- stale self-reference rows and the 491 previously-null rows).
  UPDATE public.sks_quotes_customers qc
  SET canonical_id = (
    SELECT c.customer_id
    FROM app_data.customers c
    WHERE lower(trim(c.company_name)) = lower(trim(qc.name))
    ORDER BY c.created_at ASC
    LIMIT 1
  )
  WHERE EXISTS (
    SELECT 1
    FROM app_data.customers c
    WHERE lower(trim(c.company_name)) = lower(trim(qc.name))
  );

  -- Non-unique index for canonical reverse lookup (find all Quotes customers
  -- for a given app_data.customers row). Skip if already exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'sks_quotes_customers'
      AND indexname = 'sks_quotes_customers_canonical_id_idx'
  ) THEN
    CREATE INDEX sks_quotes_customers_canonical_id_idx
      ON public.sks_quotes_customers (canonical_id)
      WHERE canonical_id IS NOT NULL;
  END IF;
END $$;
