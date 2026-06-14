-- Merge duplicate customers (same normalised company_name within a tenant).
-- For each group of duplicates, keeps the oldest record (earliest created_at).
-- Re-points all FK references before deleting the duplicate rows.
-- Guard: only runs on databases that have the sks_quotes table.

DO $$
DECLARE
  v_tenant_id  uuid := '7dee117c-98bd-4d39-af8c-2c81d02a1e85';
  v_merged     int  := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sks_quotes'
  ) THEN
    RAISE NOTICE 'sks_quotes not found — skipping customer dedup';
    RETURN;
  END IF;

  -- Build a temporary mapping: duplicate_customer_id → keeper_customer_id
  CREATE TEMP TABLE IF NOT EXISTS _cust_dedup_map AS
  SELECT
    dup.customer_id  AS dup_id,
    keeper.customer_id AS keeper_id
  FROM app_data.customers dup
  JOIN (
    SELECT DISTINCT ON (lower(trim(company_name)))
      customer_id,
      lower(trim(company_name)) AS norm_name
    FROM app_data.customers
    WHERE tenant_id = v_tenant_id
    ORDER BY lower(trim(company_name)), created_at ASC   -- keep oldest
  ) keeper ON lower(trim(dup.company_name)) = keeper.norm_name
  WHERE dup.tenant_id = v_tenant_id
    AND dup.customer_id <> keeper.customer_id;

  SELECT COUNT(*) INTO v_merged FROM _cust_dedup_map;
  RAISE NOTICE 'customer_dedup: % duplicate records to merge', v_merged;

  IF v_merged = 0 THEN
    DROP TABLE IF EXISTS _cust_dedup_map;
    RETURN;
  END IF;

  -- 1. Re-point quotes (ON DELETE RESTRICT — must do this first)
  UPDATE app_data.quote q
  SET customer_id = m.keeper_id
  FROM _cust_dedup_map m
  WHERE q.customer_id = m.dup_id;

  -- 2. Re-point sites (ON DELETE SET NULL, but re-point to avoid data loss)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app_data' AND table_name='sites' AND column_name='customer_id'
  ) THEN
    UPDATE app_data.sites s
    SET customer_id = m.keeper_id
    FROM _cust_dedup_map m
    WHERE s.customer_id = m.dup_id;
  END IF;

  -- 3. Re-point contacts (direct FK ON DELETE CASCADE — must re-point before delete)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app_data' AND table_name='contacts' AND column_name='customer_id'
  ) THEN
    UPDATE app_data.contacts c
    SET customer_id = m.keeper_id
    FROM _cust_dedup_map m
    WHERE c.customer_id = m.dup_id;
  END IF;

  -- 4. Re-point contact_customer_links (M2M — remove duplicate links, update the rest)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='app_data' AND table_name='contact_customer_links'
  ) THEN
    -- Remove links that would become duplicate after re-pointing
    DELETE FROM app_data.contact_customer_links lnk
    USING _cust_dedup_map m
    WHERE lnk.customer_id = m.dup_id
      AND EXISTS (
        SELECT 1 FROM app_data.contact_customer_links lnk2
        WHERE lnk2.contact_id = lnk.contact_id
          AND lnk2.customer_id = m.keeper_id
      );

    -- Re-point remaining links
    UPDATE app_data.contact_customer_links lnk
    SET customer_id = m.keeper_id
    FROM _cust_dedup_map m
    WHERE lnk.customer_id = m.dup_id;
  END IF;

  -- 5. Re-point tenders if present
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app_data' AND table_name='tenders' AND column_name='customer_id'
  ) THEN
    UPDATE app_data.tenders t
    SET customer_id = m.keeper_id
    FROM _cust_dedup_map m
    WHERE t.customer_id = m.dup_id;
  END IF;

  -- 6. Delete duplicate customer records
  DELETE FROM app_data.customers c
  USING _cust_dedup_map m
  WHERE c.customer_id = m.dup_id;

  RAISE NOTICE 'customer_dedup: deleted % duplicate customers', v_merged;

  DROP TABLE IF EXISTS _cust_dedup_map;
END;
$$;
