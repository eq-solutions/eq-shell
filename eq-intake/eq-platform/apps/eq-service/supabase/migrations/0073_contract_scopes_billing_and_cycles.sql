-- ============================================================
-- Migration 0069: Contract scopes — billing basis, cycle costs, audit trail
--
-- Extends contract_scopes to carry the structured commercial information from
-- the DELTA ELCOM xlsx commercial sheets. Findings drove this:
--
--   - Three billing models exist in the Equinix portfolio (audit 2026-04-27):
--       fixed           — JPs and priced Additional Items (RCD/T&T at AU sites)
--       ad_hoc          — billed per visit, no fixed annual price
--                         (RCD/T&T/Dark Site/Thermal at SY9)
--   - Cycle costs are per-asset per-cycle, captured in the SCS cycle columns
--     (1YR / 2YR / 3YR / 4YR / 5YR / 8YR / 10YR). Stored as JSONB so we don't
--     have to add 7 numeric columns.
--   - Year-totals (Y1..Y5) come from the SCS year columns AS BASE values.
--     CPI is applied at read time using customer.cpi_basis + cpi_rate.
--   - Due-years per cycle (e.g. "5YR: 14 due 2026, 3 due 2027") is operational
--     gold — it tells us which subset of assets falls due each year. Stored
--     as JSONB { 2026: 14, 2027: 3, 2028: 15 }.
--   - Source-row audit trail (workbook + row) is required so the importer can
--     reconcile updates and the supervisor can trace any value back to its
--     origin in the spreadsheet.
--
-- Existing rows still validate (all new columns nullable / defaulted).
-- The legacy scope_item / is_included / notes columns are retained for the
-- historical free-text scope rows; new imports populate the structured
-- columns instead.
-- ============================================================

ALTER TABLE public.contract_scopes
  -- Billing model
  ADD COLUMN IF NOT EXISTS billing_basis text NOT NULL DEFAULT 'fixed'
    CHECK (billing_basis IN ('fixed', 'ad_hoc')),
  -- Header description and structured commercial fields
  ADD COLUMN IF NOT EXISTS jp_code        text,         -- e.g. 'E1.25', 'M10.13' (mirror of job_plans.code, denormalised for CSV import speed)
  ADD COLUMN IF NOT EXISTS asset_qty      integer,      -- count of assets at this site / customer covered by this scope row
  ADD COLUMN IF NOT EXISTS intervals_text text,         -- raw 'A; 5' / 'M/Q/A' / 'Q/A' (free-text for now; normalisation later)
  -- Cycle costs (per-asset costs at each cycle frequency, from JP tab Total cost row)
  ADD COLUMN IF NOT EXISTS cycle_costs jsonb DEFAULT '{}'::jsonb,
    -- Shape: { "1YR": 31.25, "5YR": 562.50, ... }
  ADD COLUMN IF NOT EXISTS year_totals jsonb DEFAULT '{}'::jsonb,
    -- Shape: { "2026": 22000, "2027": 11000, "2028": 23000, "2029": 8000, "2030": 8000 }
    -- BASE values, BEFORE CPI. Apply CPI at read time using customer.cpi_basis.
  ADD COLUMN IF NOT EXISTS due_years jsonb DEFAULT '{}'::jsonb,
    -- Shape: { "2026": 14, "2027": 3, "2028": 15 } (count of assets due that year)
  -- Reference data (for next-year repricing / scoping conversations)
  ADD COLUMN IF NOT EXISTS labour_hours_per_asset jsonb DEFAULT '{}'::jsonb,
    -- Shape: { "A": 0.25, "5YR": 4.5 }
  ADD COLUMN IF NOT EXISTS unit_rate_per_asset numeric(12,2),    -- for additional_items, e.g. RCD push @ $8.50
  -- Audit trail
  ADD COLUMN IF NOT EXISTS source_workbook   text,
  ADD COLUMN IF NOT EXISTS source_sheet      text,
  ADD COLUMN IF NOT EXISTS source_row        integer,
  ADD COLUMN IF NOT EXISTS imported_at       timestamptz,
  ADD COLUMN IF NOT EXISTS imported_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_import_id  uuid,                -- groups rows imported in same xlsx
  -- Status
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'committed'
    CHECK (status IN ('staged', 'committed', 'archived')),
  -- Audit flags surfaced from the 2026-04-27 SKS / Equinix walkthrough.
  -- has_bundled_scope = TRUE when this row hides additional work inside its
  --   fixed price (e.g. T&T at SY3 delivered for $0 calendar-line, costed
  --   inside one of the JP fixed prices). Year-end deliverable + commercial
  --   review reports surface these for transparency.
  -- commercial_gap = TRUE when JP tab labour is non-zero but the SCS Annual
  --   price is $0 (e.g. E1.25 ACB annual at AU sites: 0.25 hrs/yr/asset of
  --   labour with $0 priced annual). These elevate to "audit hit" in the
  --   importer reconciliation rather than informational.
  ADD COLUMN IF NOT EXISTS has_bundled_scope boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commercial_gap    boolean NOT NULL DEFAULT false;

-- jp_code mirrors job_plans.code; useful for quick filtering and CSV import
-- without resolving the FK first
CREATE INDEX IF NOT EXISTS contract_scopes_jp_code_idx
  ON public.contract_scopes(jp_code) WHERE jp_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS contract_scopes_billing_basis_idx
  ON public.contract_scopes(billing_basis);

CREATE INDEX IF NOT EXISTS contract_scopes_source_import_idx
  ON public.contract_scopes(source_import_id) WHERE source_import_id IS NOT NULL;

-- Filter index for "show me commercial gaps" — the audit-hit register surfaced
-- to supervisors when reviewing contract_scopes for next-year repricing.
CREATE INDEX IF NOT EXISTS contract_scopes_commercial_gap_idx
  ON public.contract_scopes(tenant_id, customer_id)
  WHERE commercial_gap = true;

CREATE INDEX IF NOT EXISTS contract_scopes_bundled_scope_idx
  ON public.contract_scopes(tenant_id, customer_id)
  WHERE has_bundled_scope = true;

-- GIN indexes for JSONB columns enable efficient queries like
-- "which scope rows have an asset due in 2026?"
CREATE INDEX IF NOT EXISTS contract_scopes_due_years_gin
  ON public.contract_scopes USING gin (due_years);

CREATE INDEX IF NOT EXISTS contract_scopes_year_totals_gin
  ON public.contract_scopes USING gin (year_totals);

COMMENT ON COLUMN public.contract_scopes.billing_basis IS
  'fixed = priced as part of contract (JPs, priced Additional Items). ad_hoc = billed per visit, no fixed annual price (RCD/T&T at SY9 etc.).';

COMMENT ON COLUMN public.contract_scopes.year_totals IS
  'Per-year base $ totals from the commercial sheet ({"2026": 22000, ...}). BEFORE CPI. Apply CPI at read using customer.cpi_basis.';

COMMENT ON COLUMN public.contract_scopes.due_years IS
  'Per-year asset count due, parsed from the SCS comments column ("5YR: 14 due in 2026"). Used by the calendar generator to know which subset of assets falls due each year.';

COMMENT ON COLUMN public.contract_scopes.cycle_costs IS
  'Per-asset cost at each cycle frequency, read from the JP tab Total cost per asset row. NEVER reconstruct from labour x rate (each JP tab has its own per-frequency formula).';

COMMENT ON COLUMN public.contract_scopes.has_bundled_scope IS
  'TRUE when this row hides additional work inside its fixed price. Confirmed example: T&T at SY3 delivered for $0 line, costed inside JP fixed prices. Surfaced in year-end deliverables.';

COMMENT ON COLUMN public.contract_scopes.commercial_gap IS
  'TRUE when JP-tab labour is non-zero but SCS Annual is $0 (E1.25 ACB at AU sites). Elevates to audit-hit register, drives next-year repricing conversation with the customer.';

-- View: contract_scopes_with_cpi
-- Convenience view that returns year_totals with CPI applied per the customer rule.
CREATE OR REPLACE VIEW public.contract_scopes_with_cpi AS
SELECT
  s.*,
  c.cpi_basis,
  c.cpi_rate,
  c.contract_term_start,
  -- CPI year multiplier per cell
  jsonb_object_agg(
    yk,
    CASE
      WHEN c.cpi_basis = 'simple_on_y1_base'
        THEN yv::numeric * (1 + COALESCE(c.cpi_rate, 0) * GREATEST(0, (yk::int - EXTRACT(YEAR FROM c.contract_term_start)::int)))
      WHEN c.cpi_basis = 'compound_annual'
        THEN yv::numeric * power(1 + COALESCE(c.cpi_rate, 0), GREATEST(0, (yk::int - EXTRACT(YEAR FROM c.contract_term_start)::int)))
      ELSE yv::numeric
    END
  ) AS year_totals_with_cpi
FROM public.contract_scopes s
LEFT JOIN public.customers c ON c.id = s.customer_id
LEFT JOIN LATERAL jsonb_each(s.year_totals) AS yt(yk, yv) ON true
GROUP BY s.id, c.cpi_basis, c.cpi_rate, c.contract_term_start;

COMMENT ON VIEW public.contract_scopes_with_cpi IS
  'Contract scopes with year_totals already escalated by the customer''s CPI rule. Use this view for invoicing / reporting; raw contract_scopes for editing.';
