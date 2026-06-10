-- ============================================================
-- Migration 0083: HOTFIX — site-scope the importer wipe
--
-- Migration 0082's wipe_and_replace_contract_scopes() scoped the wipe
-- to customer_id + financial_year, which is fine for the
-- danger-zone "wipe a whole year" flow but WRONG for the per-site
-- importer: each xlsx is one site's worth of contract data, so
-- importing SY1 was wiping SY3's data too. Hit in production:
-- the SY1 import killed SY3's 19 rows seeded earlier.
--
-- Re-create the function with site_id added to every DELETE so
-- per-site imports stay isolated. Customer + tenant + year still
-- bracket the operation.
--
-- Calendar wipe also tightens from "all sites for this customer"
-- to just p_site_id for the same reason — calendar entries are
-- already per-site (pm_calendar.site_id), so the over-broad wipe
-- was clobbering other sites' calendar too when it ran.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wipe_and_replace_contract_scopes(
  p_customer_id uuid,
  p_site_id     uuid,
  p_year        integer,
  p_rows        jsonb,
  p_wipe_first  boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id        uuid;
  v_year_text        text  := p_year::text;
  v_year_start       date  := make_date(p_year, 1, 1);
  v_year_end         date  := make_date(p_year + 1, 1, 1);
  v_wiped_scopes     int   := 0;
  v_wiped_calendar   int   := 0;
  v_wiped_gaps       int   := 0;
  v_inserted         int   := 0;
  v_pre_wipe_snapshot jsonb := '[]'::jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id
    FROM public.customers WHERE id = p_customer_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found or not accessible', p_customer_id USING ERRCODE = '42704';
  END IF;
  PERFORM 1 FROM public.sites
   WHERE id = p_site_id AND customer_id = p_customer_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site % is not part of customer %', p_site_id, p_customer_id USING ERRCODE = '42704';
  END IF;

  IF p_wipe_first THEN
    -- Snapshot before deleting. Site-scoped to match the wipe.
    SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_pre_wipe_snapshot
    FROM (
      SELECT id, jp_code, scope_item, asset_qty, intervals_text,
             billing_basis, year_totals, due_years, source_import_id,
             site_id
      FROM public.contract_scopes
      WHERE customer_id = p_customer_id
        AND tenant_id = v_tenant_id
        AND site_id = p_site_id
        AND financial_year = v_year_text
    ) s;

    -- Wipe order: gaps first (FK to contract_scopes), then calendar,
    -- then scopes themselves. All three site-scoped.
    WITH d AS (
      DELETE FROM public.scope_coverage_gaps
       WHERE customer_id = p_customer_id
         AND tenant_id = v_tenant_id
         AND site_id = p_site_id
         AND contract_year = p_year
      RETURNING id
    ) SELECT COUNT(*) INTO v_wiped_gaps FROM d;

    WITH d AS (
      DELETE FROM public.pm_calendar
       WHERE site_id = p_site_id
         AND tenant_id = v_tenant_id
         AND ((start_time >= v_year_start AND start_time < v_year_end)
              OR (start_time IS NULL AND financial_year = v_year_text))
      RETURNING id
    ) SELECT COUNT(*) INTO v_wiped_calendar FROM d;

    WITH d AS (
      DELETE FROM public.contract_scopes
       WHERE customer_id = p_customer_id
         AND tenant_id = v_tenant_id
         AND site_id = p_site_id
         AND financial_year = v_year_text
      RETURNING id
    ) SELECT COUNT(*) INTO v_wiped_scopes FROM d;
  END IF;

  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years, labour_hours_per_asset,
    unit_rate_per_asset, notes,
    source_workbook, source_sheet, source_row, imported_at, source_import_id,
    has_bundled_scope, commercial_gap, status
  )
  SELECT
    v_tenant_id, p_customer_id,
    COALESCE((r->>'site_id')::uuid, p_site_id),
    v_year_text, r->>'scope_item', true,
    NULLIF(r->>'jp_code', ''),
    NULLIF(r->>'asset_qty', '')::int,
    r->>'intervals_text',
    r->>'billing_basis',
    COALESCE(r->'cycle_costs', '{}'::jsonb),
    COALESCE(r->'year_totals', '{}'::jsonb),
    COALESCE(r->'due_years', '{}'::jsonb),
    COALESCE(r->'labour_hours_per_asset', '{}'::jsonb),
    NULLIF(r->>'unit_rate_per_asset', '')::numeric,
    NULLIF(r->>'notes', ''),
    r->>'source_workbook', r->>'source_sheet',
    NULLIF(r->>'source_row', '')::int,
    now(),
    NULLIF(r->>'source_import_id', '')::uuid,
    COALESCE((r->>'has_bundled_scope')::boolean, false),
    COALESCE((r->>'commercial_gap')::boolean, false),
    'committed'
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'wiped_scopes', v_wiped_scopes,
    'wiped_calendar', v_wiped_calendar,
    'wiped_gaps', v_wiped_gaps,
    'inserted', v_inserted,
    'pre_wipe_snapshot', v_pre_wipe_snapshot
  );
END;
$$;

COMMENT ON FUNCTION public.wipe_and_replace_contract_scopes IS
  'Atomic per-SITE wipe-and-insert for contract-sheet imports. Site-scoped wipes (0083 hotfix) so per-site imports do not clobber sibling sites'' data.';
