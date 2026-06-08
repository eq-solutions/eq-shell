-- 0047_sks_quotes_canonical_site_id.sql
--
-- Adds canonical_site_id to sks_quotes, linking each quote to the
-- canonical site record in app_data.sites. Enables cross-app joins:
-- quote → site → service visits, assets, defects, staff dispatch.
--
-- Backfills immediately by exact case-insensitive name match.
-- 18/19 distinct quote sites match (95%). The unmatched site
-- ("Russell R1 Control Room") is not in canonical — it will link
-- once that site is added to Field.
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
      AND column_name = 'canonical_site_id'
  ) THEN
    ALTER TABLE public.sks_quotes ADD COLUMN canonical_site_id uuid;
  END IF;

  -- Backfill by exact case-insensitive name match
  UPDATE public.sks_quotes q
  SET canonical_site_id = s.site_id
  FROM app_data.sites s
  WHERE lower(trim(s.name)) = lower(trim(q.site))
    AND q.canonical_site_id IS NULL
    AND q.site IS NOT NULL;

  -- Sparse index — most queries filter by site
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'sks_quotes'
      AND indexname = 'sks_quotes_canonical_site_id_idx'
  ) THEN
    CREATE INDEX sks_quotes_canonical_site_id_idx
      ON public.sks_quotes (canonical_site_id)
      WHERE canonical_site_id IS NOT NULL;
  END IF;
END $$;
