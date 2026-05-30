-- 0024_gm_reports.sql
-- GM Reports module schema — Workbench period uploads + parsed job rows.
-- Re-homed from supabase/migrations/2026_05_29_gm_reports.sql (which targeted the
-- shared control plane) into the per-tenant tenant-migrations set, so every tenant
-- reproduces the GM Reports surface.
--
-- Canonical-correct shape = the source migration UNION the live SKS additions:
--   * tenant_id present + RLS scoped to app_metadata.tenant_id. The live ehowg
--     tables were hand-applied WITHOUT tenant_id — a multi-tenant isolation gap.
--   * is_archived carried over from the live archive feature.
--
-- No RPCs (parse/briefing logic lives in Netlify functions, not the DB).
-- Idempotent + transactional. EQ (proving ground) first; the SKS reshape
-- (ADD tenant_id + backfill on the live tables) is the gated Phase C step.

BEGIN;

-- ── Periods ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_data.gm_report_periods (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  period_code           text        NOT NULL,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  uploaded_by           uuid,
  total_contract        numeric,
  jtd_invoiced          numeric,
  jtd_cost              numeric,
  net_cash_position     numeric,
  gp_at_completion      numeric,
  overall_gp_pct        numeric,
  cash_neg_count        integer,
  forecast_loss_count   integer,
  outstanding_pos       numeric,
  briefing              jsonb,
  briefing_generated_at timestamptz,
  is_archived           boolean     NOT NULL DEFAULT false,
  UNIQUE (tenant_id, period_code)
);

ALTER TABLE app_data.gm_report_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant sees own periods" ON app_data.gm_report_periods;
CREATE POLICY "Tenant sees own periods"
  ON app_data.gm_report_periods FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));

DROP POLICY IF EXISTS "Service role full access on periods" ON app_data.gm_report_periods;
CREATE POLICY "Service role full access on periods"
  ON app_data.gm_report_periods FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Jobs ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_data.gm_report_jobs (
  id                           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id                    uuid    NOT NULL REFERENCES app_data.gm_report_periods(id) ON DELETE CASCADE,
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
  cash_gap         numeric GENERATED ALWAYS AS (jtd_cost_val - jtd_invoicing) STORED,
  is_cash_negative boolean GENERATED ALWAYS AS (jtd_cost_val > jtd_invoicing) STORED,
  is_forecast_loss boolean GENERATED ALWAYS AS (COALESCE(gross_profit, 0) < 0) STORED,
  is_overhead      boolean GENERATED ALWAYS AS (
    COALESCE(contract_valuation, 0) = 0 AND COALESCE(jtd_invoicing, 0) = 0
  ) STORED
);

CREATE INDEX IF NOT EXISTS gm_report_jobs_period_id_idx   ON app_data.gm_report_jobs (period_id);
CREATE INDEX IF NOT EXISTS gm_report_jobs_job_manager_idx ON app_data.gm_report_jobs (period_id, job_manager);

ALTER TABLE app_data.gm_report_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant sees own jobs" ON app_data.gm_report_jobs;
CREATE POLICY "Tenant sees own jobs"
  ON app_data.gm_report_jobs FOR SELECT TO authenticated
  USING (period_id IN (
    SELECT id FROM app_data.gm_report_periods
    WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  ));

DROP POLICY IF EXISTS "Service role full access on jobs" ON app_data.gm_report_jobs;
CREATE POLICY "Service role full access on jobs"
  ON app_data.gm_report_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Grants (browser reads via RLS; writes are service-role) ─────────────────
REVOKE ALL  ON app_data.gm_report_periods FROM anon, authenticated;
REVOKE ALL  ON app_data.gm_report_jobs    FROM anon, authenticated;
GRANT SELECT ON app_data.gm_report_periods TO authenticated;
GRANT SELECT ON app_data.gm_report_jobs    TO authenticated;
GRANT ALL    ON app_data.gm_report_periods TO service_role;
GRANT ALL    ON app_data.gm_report_jobs    TO service_role;

COMMIT;
