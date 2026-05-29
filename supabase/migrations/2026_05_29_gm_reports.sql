-- Migration: 2026_05_29_gm_reports
-- Target:    eq-canonical (jvknxcmbtrfnxfrwfimn)
-- Purpose:   GM Reports module — stores Workbench period uploads and AI briefings.
--
-- Two tables in app_data schema:
--   gm_report_periods  — one row per uploaded Workbench period per tenant.
--   gm_report_jobs     — all parsed job rows for a period.
--
-- Computed columns on gm_report_jobs handle cash gap / loss flags at the
-- DB layer so queries never need to re-derive them.
--
-- RLS: tenant-scoped via tenant_id column. Service-role functions bypass RLS;
-- browser clients (supabase JWT) are blocked to their own tenant_id.

-- ============================================================================
-- PERIODS
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.gm_report_periods (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  period_code           text        NOT NULL,       -- e.g. "2026/011"
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  uploaded_by           uuid,                       -- shell_control.users.id

  -- Portfolio KPIs computed on upload
  total_contract        numeric,
  jtd_invoiced          numeric,
  jtd_cost              numeric,
  net_cash_position     numeric,
  gp_at_completion      numeric,
  overall_gp_pct        numeric,
  cash_neg_count        int,
  forecast_loss_count   int,
  outstanding_pos       numeric,

  -- AI briefing stored after generation
  briefing              jsonb,
  briefing_generated_at timestamptz,

  UNIQUE (tenant_id, period_code)
);

ALTER TABLE app_data.gm_report_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant sees own periods"
  ON app_data.gm_report_periods FOR SELECT
  TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

CREATE POLICY "Service role full access on periods"
  ON app_data.gm_report_periods FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- JOBS
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.gm_report_jobs (
  id                           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id                    uuid    NOT NULL REFERENCES app_data.gm_report_periods(id) ON DELETE CASCADE,

  -- Direct from Workbench export (column order preserved)
  last_forecast_period         text,
  state                        text,
  profit_centre                text,
  job_manager                  text    NOT NULL,
  job_code                     text    NOT NULL,
  job_description              text    NOT NULL,
  wip_code                     text,
  mtd_claims                   numeric,
  mtd_cost                     numeric,
  jtd_invoicing                numeric NOT NULL DEFAULT 0,
  jtd_cost_val                 numeric NOT NULL DEFAULT 0,
  contract_valuation           numeric NOT NULL DEFAULT 0,
  forecast_at_completion_costs numeric,
  gross_profit                 numeric,
  gp_pct                       numeric,
  variance_ffc                 numeric,
  outstanding_pos              numeric NOT NULL DEFAULT 0,

  -- Computed: cash_gap > 0 means we spent more than we claimed
  cash_gap         numeric     GENERATED ALWAYS AS (jtd_cost_val - jtd_invoicing) STORED,
  is_cash_negative boolean     GENERATED ALWAYS AS (jtd_cost_val > jtd_invoicing) STORED,
  is_forecast_loss boolean     GENERATED ALWAYS AS (COALESCE(gross_profit, 0) < 0) STORED,
  -- Overhead codes: estimating hours, defects/liability — no contract value, no invoicing
  is_overhead      boolean     GENERATED ALWAYS AS (
    COALESCE(contract_valuation, 0) = 0 AND COALESCE(jtd_invoicing, 0) = 0
  ) STORED
);

CREATE INDEX IF NOT EXISTS gm_report_jobs_period_id_idx ON app_data.gm_report_jobs (period_id);
CREATE INDEX IF NOT EXISTS gm_report_jobs_job_manager_idx ON app_data.gm_report_jobs (period_id, job_manager);

ALTER TABLE app_data.gm_report_jobs ENABLE ROW LEVEL SECURITY;

-- Jobs inherit tenant scope via their period
CREATE POLICY "Tenant sees own jobs"
  ON app_data.gm_report_jobs FOR SELECT
  TO authenticated
  USING (
    period_id IN (
      SELECT id FROM app_data.gm_report_periods
      WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    )
  );

CREATE POLICY "Service role full access on jobs"
  ON app_data.gm_report_jobs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
