-- One-time import of sks_quotes → app_data.quote + quote_line_item.
-- Guard: only runs on databases that have the sks_quotes table (ehow / sks-canonical).
-- Safe no-op on all other tenants.

DO $$
DECLARE
  v_tenant_id  uuid := '7dee117c-98bd-4d39-af8c-2c81d02a1e85';
  v_imported   int  := 0;
BEGIN
  -- Guard: only run on the sks-canonical database
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sks_quotes'
  ) THEN
    RAISE NOTICE 'sks_quotes not found — skipping flask quote import';
    RETURN;
  END IF;

  -- Insert missing quotes (skip any already imported by quote_number or external_id)
  WITH

  -- Resolve customer for each Flask quote:
  --   1. Use canonical_customer_id if set
  --   2. Otherwise match by normalised company name, taking the oldest record
  customer_lookup AS (
    SELECT DISTINCT ON (lower(trim(c.company_name)))
      lower(trim(c.company_name)) AS norm_name,
      c.customer_id
    FROM app_data.customers c
    WHERE c.tenant_id = v_tenant_id
    ORDER BY lower(trim(c.company_name)), c.created_at ASC
  ),

  flask AS (
    SELECT
      sq.id                              AS flask_id,
      sq.number                          AS quote_number,
      sq.id::text                        AS external_id,
      v_tenant_id                        AS tenant_id,

      COALESCE(
        sq.canonical_customer_id,
        cl.customer_id
      )                                  AS customer_id,

      sq.project_name,
      sq.attn_name,
      sq.attn_first_name,
      sq.attn_phone,
      sq.address,
      sq.scope_of_works,
      sq.estimator_name,
      sq.estimator_initials,
      sq.sent_at,
      sq.expires_at,
      sq.workbench_job_no,
      sq.created_at,

      -- Status mapping
      CASE sq.status
        WHEN 'Draft'                THEN 'draft'
        WHEN 'Submitted'            THEN 'submitted'
        WHEN 'Client Reviewing'     THEN 'client-reviewing'
        WHEN 'Verbal Win'           THEN 'verbal-win'
        WHEN 'Won-Awaiting Job No'  THEN 'won-awaiting-job-no'
        WHEN 'Won-Job Created'      THEN 'won-job-created'
        WHEN 'Lost'                 THEN 'lost'
        WHEN 'On Hold'              THEN 'on-hold'
        WHEN 'Withdrawn'            THEN 'superseded'
        ELSE                             'draft'
      END                                AS status,

      -- Totals from JSONB line items (field is 'line_total', numeric dollars)
      COALESCE((
        SELECT SUM((item->>'line_total')::numeric)
        FROM jsonb_array_elements(COALESCE(sq.labour,   '[]'::jsonb)) AS item
      ), 0) +
      COALESCE((
        SELECT SUM((item->>'line_total')::numeric)
        FROM jsonb_array_elements(COALESCE(sq.materials,'[]'::jsonb)) AS item
      ), 0) +
      COALESCE((
        SELECT SUM((item->>'line_total')::numeric)
        FROM jsonb_array_elements(COALESCE(sq.subcon,   '[]'::jsonb)) AS item
      ), 0)                              AS subtotal_dollars,

      sq.labour,
      sq.materials,
      sq.subcon

    FROM public.sks_quotes sq
    LEFT JOIN customer_lookup cl
           ON lower(trim(sq.customer_name)) = cl.norm_name
    WHERE sq.deleted_at IS NULL
      -- Skip already-imported quotes (matched by external_id or canonical_id)
      AND sq.id::text NOT IN (
        SELECT external_id FROM app_data.quote
        WHERE tenant_id = v_tenant_id AND external_id IS NOT NULL
      )
      AND (
        sq.canonical_id IS NULL
        OR sq.canonical_id NOT IN (
          SELECT quote_id FROM app_data.quote WHERE tenant_id = v_tenant_id
        )
      )
  ),

  inserted AS (
    INSERT INTO app_data.quote (
      tenant_id, customer_id, quote_number, external_id,
      project_name, attn_name, attn_first_name, attn_phone,
      address, scope_of_works, estimator_name, estimator_initials,
      status, subtotal_cents, gst_cents, total_cents,
      sent_at, expires_at, workbench_job_no,
      imported_at, imported_from, created_at, updated_at
    )
    SELECT
      f.tenant_id,
      f.customer_id,
      f.quote_number,
      f.external_id,
      f.project_name,
      f.attn_name,
      f.attn_first_name,
      f.attn_phone,
      f.address,
      f.scope_of_works,
      f.estimator_name,
      f.estimator_initials,
      f.status,
      ROUND(f.subtotal_dollars * 100)::bigint           AS subtotal_cents,
      ROUND(f.subtotal_dollars * 10)::bigint            AS gst_cents,
      ROUND(f.subtotal_dollars * 110)::bigint           AS total_cents,
      f.sent_at,
      f.expires_at,
      f.workbench_job_no,
      now()                                             AS imported_at,
      'sks_quotes'                                      AS imported_from,
      f.created_at,
      now()                                             AS updated_at
    FROM flask f
    WHERE f.customer_id IS NOT NULL
    RETURNING quote_id, external_id
  )

  SELECT COUNT(*) INTO v_imported FROM inserted;

  RAISE NOTICE 'flask_quote_import: inserted % quotes', v_imported;

  -- Insert line items for imported quotes
  INSERT INTO app_data.quote_line_item (
    tenant_id, quote_id, line_number, description, quantity_thousandths,
    unit, unit_rate_cents, line_total_cents, category, imported_at, imported_from
  )
  SELECT
    v_tenant_id,
    ins.quote_id,
    ROW_NUMBER() OVER (PARTITION BY ins.quote_id ORDER BY item_order)::int AS line_number,
    item->>'description'                                                     AS description,
    ROUND((item->>'qty')::numeric * 1000)::bigint                           AS quantity_thousandths,
    item->>'unit'                                                            AS unit,
    ROUND((item->>'rate')::numeric * 100)::bigint                           AS unit_rate_cents,
    ROUND((item->>'line_total')::numeric * 100)::bigint                     AS line_total_cents,
    cat                                                                      AS category,
    now()                                                                    AS imported_at,
    'sks_quotes'                                                             AS imported_from
  FROM (
    -- Labour items
    SELECT
      i.quote_id,
      1                                                   AS item_order,
      elem                                                AS item,
      'labour'                                            AS cat
    FROM (
      SELECT ins2.quote_id, ins2.external_id,
             jsonb_array_elements(COALESCE(sq.labour,'[]'::jsonb)) AS elem
      FROM (SELECT quote_id, external_id FROM app_data.quote
            WHERE tenant_id = v_tenant_id AND imported_from = 'sks_quotes') ins2
      JOIN public.sks_quotes sq ON sq.id::text = ins2.external_id
    ) i

    UNION ALL

    -- Material items
    SELECT
      i.quote_id, 2, elem, 'material'
    FROM (
      SELECT ins2.quote_id, ins2.external_id,
             jsonb_array_elements(COALESCE(sq.materials,'[]'::jsonb)) AS elem
      FROM (SELECT quote_id, external_id FROM app_data.quote
            WHERE tenant_id = v_tenant_id AND imported_from = 'sks_quotes') ins2
      JOIN public.sks_quotes sq ON sq.id::text = ins2.external_id
    ) i

    UNION ALL

    -- Subcontractor items
    SELECT
      i.quote_id, 3, elem, 'subcontractor'
    FROM (
      SELECT ins2.quote_id, ins2.external_id,
             jsonb_array_elements(COALESCE(sq.subcon,'[]'::jsonb)) AS elem
      FROM (SELECT quote_id, external_id FROM app_data.quote
            WHERE tenant_id = v_tenant_id AND imported_from = 'sks_quotes') ins2
      JOIN public.sks_quotes sq ON sq.id::text = ins2.external_id
    ) i
  ) AS all_items
  -- Only insert line items for quotes we just imported (or any sks_quotes import)
  JOIN (SELECT quote_id FROM app_data.quote WHERE tenant_id = v_tenant_id AND imported_from = 'sks_quotes') ins
    ON all_items.quote_id = ins.quote_id
  -- Avoid duplicates if migration runs twice
  WHERE all_items.quote_id NOT IN (
    SELECT DISTINCT quote_id FROM app_data.quote_line_item WHERE tenant_id = v_tenant_id
      AND imported_from = 'sks_quotes'
  );

  -- Backfill canonical_id on sks_quotes so future runs detect these as already imported
  UPDATE public.sks_quotes sq
  SET canonical_id = q.quote_id
  FROM app_data.quote q
  WHERE q.tenant_id = v_tenant_id
    AND q.external_id = sq.id::text
    AND sq.canonical_id IS NULL;

END;
$$;
