-- Migration: 0066_sks_comms_layer
-- @tenant-scope: sks
-- Target:    ehowgjardagevnrluult (SKS tenant plane only — not zaap/EQ)
-- Purpose:   NSW Comms job tracking layer.
--            Replaces the Microsoft Working Job List Excel workbook.
--            Tracks the full job pipeline: quoted → active → on_hold → complete → closed.
--            Two core tables: sks_comms_jobs (one row per SKS job number)
--            and sks_comms_po_lines (one row per Microsoft PO line item).
--            Two reference tables: sks_comms_materials, sks_comms_labour_rates.
--            All tables RLS-ON, service_role only (accessed via Shell Netlify fns).

-- ─── JOBS ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.sks_comms_jobs (
  job_id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number        text,                          -- SKS job # (null until PO received for quoted jobs)
  site_code         text        NOT NULL,          -- SYD27, SYD29, SYD05, SYD60
  site_name         text,                          -- Equinix SY9 etc.
  client            text        NOT NULL DEFAULT 'Microsoft',
  status            text        NOT NULL DEFAULT 'quoted'
                      CHECK (status IN ('quoted','active','on_hold','complete','closed')),
  description       text,                          -- primary job description (from first PO line)
  assigned_to       text,                          -- tech name — filled by Jack
  start_date        date,
  target_completion date,
  on_hold_since     date,
  mop_received      boolean     NOT NULL DEFAULT false,
  pre_cable_done    boolean     NOT NULL DEFAULT false,
  post_dock_done    boolean     NOT NULL DEFAULT false,
  invoice_raised    boolean     NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sks_comms_jobs_status_idx    ON app_data.sks_comms_jobs (status);
CREATE INDEX IF NOT EXISTS sks_comms_jobs_site_idx      ON app_data.sks_comms_jobs (site_code);
CREATE INDEX IF NOT EXISTS sks_comms_jobs_job_num_idx   ON app_data.sks_comms_jobs (job_number) WHERE job_number IS NOT NULL;

-- ─── PO LINES ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.sks_comms_po_lines (
  line_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid        NOT NULL REFERENCES app_data.sks_comms_jobs(job_id) ON DELETE CASCADE,
  po_number         text,
  description       text        NOT NULL,
  requestor         text,                -- Microsoft contact (AJ, DON, VINCENT, ZEESHAN, SHIBIN)
  fid_number        text,                -- Microsoft FID / JOB ID
  quote_number      text,                -- SKS quote reference
  date_approval     date,
  hours             numeric,
  materials_cost    numeric,
  price_ex_gst      numeric,
  complete_notes    text,                -- partial completion notes (e.g. "3 racks damaged")
  invoice_number    text,                -- SKS invoice # once raised
  invoiced_amount   numeric,             -- $ invoiced against this line
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sks_comms_po_lines_job_idx ON app_data.sks_comms_po_lines (job_id);

-- ─── REFERENCE: MATERIALS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.sks_comms_materials (
  material_id   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  site_scope    text    NOT NULL,   -- MEL01, MEL25, SYD, ALL
  item          text    NOT NULL,
  supplier      text,
  unit_price    numeric
);

-- ─── REFERENCE: LABOUR RATES ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.sks_comms_labour_rates (
  rate_id       uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  site_scope    text    NOT NULL,   -- MEL or SYD
  item          text    NOT NULL,
  cost_rate     numeric,
  charge_rate   numeric
);

-- ─── UPDATED_AT TRIGGER ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_data._sks_comms_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS sks_comms_jobs_updated_at ON app_data.sks_comms_jobs;
CREATE TRIGGER sks_comms_jobs_updated_at
  BEFORE UPDATE ON app_data.sks_comms_jobs
  FOR EACH ROW EXECUTE FUNCTION app_data._sks_comms_set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE app_data.sks_comms_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.sks_comms_po_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.sks_comms_materials    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.sks_comms_labour_rates ENABLE ROW LEVEL SECURITY;

-- No policies = service_role only (authenticated/anon blocked by default privileges).
-- Shell Netlify functions use service_role; browser never touches these tables directly.
