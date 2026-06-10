-- ============================================================
-- Migration 0082: Contract-scope importer safety helpers
--
-- Two pieces:
--   1. wipe_and_replace_contract_scopes() RPC — atomic wipe-and-insert.
--      The previous importer (PR #27) issued separate Supabase calls for
--      the wipes and the insert, so a partial failure could leave a
--      customer with zero contract data and no easy recovery.
--      This RPC runs the whole sequence in one PG transaction (the
--      function body is implicitly transactional). Returns counts +
--      a snapshot of the rows wiped, which the importer logs to
--      audit_logs.metadata so accidental wipes are recoverable.
--
--   2. auto_populate_scope_coverage_gaps() trigger — fires when a
--      pm_calendar row flips draft_status to 'committed' and inserts
--      scope_coverage_gaps rows for any contract_scopes row with
--      year_totals[year] > 0, billing_basis='fixed', and no calendar
--      entry referencing it. Migration 0077 designed this auto-trigger
--      but didn't ship it; doing so now means the gaps register stays
--      live without manual intervention.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RPC: atomic wipe-and-replace
-- ------------------------------------------------------------
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
  v_site_ids         uuid[];
  v_wiped_scopes     int   := 0;
  v_wiped_calendar   int   := 0;
  v_wiped_gaps       int   := 0;
  v_inserted         int   := 0;
  v_pre_wipe_snapshot jsonb := '[]'::jsonb;
BEGIN
  -- Resolve tenant + verify customer exists. RLS will further constrain
  -- visibility — if the caller can't see the customer, this returns NULL
  -- and we abort.
  SELECT tenant_id INTO v_tenant_id
    FROM public.customers
   WHERE id = p_customer_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found or not accessible', p_customer_id
      USING ERRCODE = '42704';
  END IF;

  -- Verify the site belongs to this customer + tenant.
  PERFORM 1
    FROM public.sites
   WHERE id = p_site_id
     AND customer_id = p_customer_id
     AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site % is not part of customer %', p_site_id, p_customer_id
      USING ERRCODE = '42704';
  END IF;

  IF p_wipe_first THEN
    -- Snapshot before deleting so audit_logs can carry recovery data.
    SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      INTO v_pre_wipe_snapshot
      FROM (
        SELECT id, jp_code, scope_item, asset_qty, intervals_text,
               billing_basis, year_totals, due_years, source_import_id
          FROM public.contract_scopes
         WHERE customer_id = p_customer_id
           AND tenant_id   = v_tenant_id
           AND financial_year = v_year_text
      ) s;

    SELECT array_agg(id) INTO v_site_ids
      FROM public.sites
     WHERE customer_id = p_customer_id
       AND tenant_id   = v_tenant_id;

    -- Wipe order: gaps first (to avoid leaving orphans pointing at scope
    -- rows), then calendar (no FK back to scope), then scopes.
    WITH d AS (
      DELETE FROM public.scope_coverage_gaps
       WHERE customer_id  = p_customer_id
         AND tenant_id    = v_tenant_id
         AND contract_year = p_year
      RETURNING id
    ) SELECT COUNT(*) INTO v_wiped_gaps FROM d;

    IF v_site_ids IS NOT NULL AND array_length(v_site_ids, 1) > 0 THEN
      WITH d AS (
        DELETE FROM public.pm_calendar
         WHERE site_id    = ANY(v_site_ids)
           AND tenant_id  = v_tenant_id
           AND ((start_time >= v_year_start AND start_time < v_year_end)
                OR (start_time IS NULL AND financial_year = v_year_text))
        RETURNING id
      ) SELECT COUNT(*) INTO v_wiped_calendar FROM d;
    END IF;

    WITH d AS (
      DELETE FROM public.contract_scopes
       WHERE customer_id    = p_customer_id
         AND tenant_id      = v_tenant_id
         AND financial_year = v_year_text
      RETURNING id
    ) SELECT COUNT(*) INTO v_wiped_scopes FROM d;
  END IF;

  -- Insert. Caller passes p_rows as a JSONB array of row objects shaped
  -- to the contract_scopes columns (with site_id pinned per-row in case
  -- rows from different sheets target different sites — current importer
  -- writes them all under p_site_id).
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years, labour_hours_per_asset,
    unit_rate_per_asset, notes,
    source_workbook, source_sheet, source_row, imported_at, source_import_id,
    has_bundled_scope, commercial_gap, status
  )
  SELECT
    v_tenant_id,
    p_customer_id,
    COALESCE((r->>'site_id')::uuid, p_site_id),
    v_year_text,
    r->>'scope_item',
    true,
    NULLIF(r->>'jp_code', ''),
    NULLIF(r->>'asset_qty', '')::int,
    r->>'intervals_text',
    r->>'billing_basis',
    COALESCE(r->'cycle_costs',           '{}'::jsonb),
    COALESCE(r->'year_totals',           '{}'::jsonb),
    COALESCE(r->'due_years',             '{}'::jsonb),
    COALESCE(r->'labour_hours_per_asset','{}'::jsonb),
    NULLIF(r->>'unit_rate_per_asset', '')::numeric,
    NULLIF(r->>'notes', ''),
    r->>'source_workbook',
    r->>'source_sheet',
    NULLIF(r->>'source_row', '')::int,
    now(),
    NULLIF(r->>'source_import_id', '')::uuid,
    COALESCE((r->>'has_bundled_scope')::boolean, false),
    COALESCE((r->>'commercial_gap')::boolean, false),
    'committed'
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'wiped_scopes',      v_wiped_scopes,
    'wiped_calendar',    v_wiped_calendar,
    'wiped_gaps',        v_wiped_gaps,
    'inserted',          v_inserted,
    'pre_wipe_snapshot', v_pre_wipe_snapshot
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.wipe_and_replace_contract_scopes(uuid, uuid, integer, jsonb, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.wipe_and_replace_contract_scopes IS
  'Atomic wipe-and-insert for contract-sheet imports. Replaces the per-statement Supabase calls that the previous importer used so partial failures roll back cleanly. Returns counts + snapshot of wiped rows for audit_logs recovery.';

-- ------------------------------------------------------------
-- 2. Calendar-commit trigger that auto-populates scope_coverage_gaps
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_populate_scope_coverage_gaps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- needs to write to scope_coverage_gaps under any caller
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year        integer;
  v_customer_id uuid;
BEGIN
  -- Determine which contract year this calendar row covers. Prefer the
  -- start_time year; fall back to the financial_year text column.
  v_year := COALESCE(
    EXTRACT(YEAR FROM NEW.start_time)::integer,
    CASE WHEN NEW.financial_year ~ '^\d{4}$'      THEN NEW.financial_year::integer
         WHEN NEW.financial_year ~ '^\d{4}-\d{4}$' THEN split_part(NEW.financial_year, '-', 2)::integer
         ELSE NULL
    END
  );
  IF v_year IS NULL THEN RETURN NEW; END IF;

  -- Customer for this calendar row resolved through the site.
  SELECT customer_id INTO v_customer_id
    FROM public.sites WHERE id = NEW.site_id;
  IF v_customer_id IS NULL THEN RETURN NEW; END IF;

  -- Insert one gap row per uncovered priced scope. ON CONFLICT skips
  -- existing gaps, which is also why multiple calendar rows flipping to
  -- committed in the same statement don't produce duplicates.
  INSERT INTO public.scope_coverage_gaps (
    tenant_id, customer_id, site_id, contract_scope_id, contract_year,
    jp_code, scope_description, expected_amount, intervals_text,
    status, severity, detection_reason
  )
  SELECT
    cs.tenant_id, cs.customer_id, cs.site_id, cs.id, v_year,
    cs.jp_code, cs.scope_item,
    (cs.year_totals->>v_year::text)::numeric,
    cs.intervals_text,
    'open', 'medium',  -- the existing severity trigger overrides this from expected_amount
    'auto: scope priced for ' || v_year || ' but no calendar entry references it'
  FROM public.contract_scopes cs
  WHERE cs.customer_id = v_customer_id
    AND cs.financial_year = v_year::text
    AND cs.billing_basis = 'fixed'
    AND COALESCE((cs.year_totals->>v_year::text)::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1
        FROM public.pm_calendar pc
       WHERE pc.contract_scope_id = cs.id
         AND pc.is_active = true
         AND pc.draft_status = 'committed'
    )
  ON CONFLICT (contract_scope_id, contract_year) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_populate_scope_coverage_gaps() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pm_calendar_auto_populate_gaps ON public.pm_calendar;
CREATE TRIGGER pm_calendar_auto_populate_gaps
  AFTER UPDATE OF draft_status ON public.pm_calendar
  FOR EACH ROW
  WHEN (OLD.draft_status IS DISTINCT FROM NEW.draft_status AND NEW.draft_status = 'committed')
  EXECUTE FUNCTION public.auto_populate_scope_coverage_gaps();

COMMENT ON FUNCTION public.auto_populate_scope_coverage_gaps IS
  'Fires when a pm_calendar row commits and back-fills scope_coverage_gaps for any priced contract_scopes row with year_totals > 0 and no calendar coverage. Designed in migration 0077; auto-trigger now wired up.';
