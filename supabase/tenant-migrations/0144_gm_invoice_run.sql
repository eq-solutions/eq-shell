-- 0144_gm_invoice_run.sql
-- Per-job invoicing status for the monthly invoicing run workflow.
--
-- Keyed by (period_id, job_code) NOT by job_id — job_code is the Workbench
-- string identifier (e.g. "27109") which is stable across period re-uploads.
-- upload-gm-report.ts deletes and re-inserts gm_report_jobs on every upload,
-- so a job_id FK would wipe all invoice statuses on re-upload. period_id is
-- safe to FK on because it is upserted (same period_code → same UUID) and
-- only deleted when the whole period is explicitly removed.

CREATE TABLE IF NOT EXISTS app_data.gm_invoice_run (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    text        NOT NULL,
  period_id    uuid        NOT NULL REFERENCES app_data.gm_report_periods(id) ON DELETE CASCADE,
  job_code     text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('invoiced', 'story')),
  reason_code  text        CHECK (reason_code IN (
                              'waiting_po',
                              'variation',
                              'on_hold',
                              'dispute',
                              'not_progressed',
                              'other'
                            )),
  reason_note  text        CHECK (char_length(reason_note) <= 200),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  UNIQUE (period_id, job_code)
);

CREATE INDEX IF NOT EXISTS gm_invoice_run_period_idx ON app_data.gm_invoice_run (period_id);
CREATE INDEX IF NOT EXISTS gm_invoice_run_tenant_idx  ON app_data.gm_invoice_run (tenant_id);

ALTER TABLE app_data.gm_invoice_run ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_read"  ON app_data.gm_invoice_run;
DROP POLICY IF EXISTS "tenant_write" ON app_data.gm_invoice_run;

CREATE POLICY "tenant_read" ON app_data.gm_invoice_run
  FOR SELECT USING (
    tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')
  );

CREATE POLICY "tenant_write" ON app_data.gm_invoice_run
  FOR ALL USING (
    tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')
  ) WITH CHECK (
    tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON app_data.gm_invoice_run TO authenticated;
GRANT ALL ON app_data.gm_invoice_run TO service_role;
