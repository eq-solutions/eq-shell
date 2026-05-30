-- Migration: 0020_service_cmms
-- Target:    Per-tenant data plane (every tenant Supabase project)
-- Purpose:   Codify the EQ Service CMMS tables that were applied OUT OF BAND to
--            sks-canonical and never captured as a tenant migration:
--              service_visits, service_task_completions,
--              asset_test_results, asset_defects
--
--            These exist on sks-canonical (asset_test_results has live rows) but
--            NOT on eq-canonical-internal, and a freshly provisioned tenant would
--            never get them. This migration makes the runner reproduce them on
--            every tenant. See docs/ARCHITECTURE-V2.md "Source of truth model".
--
-- Faithful: column shapes / constraints / indexes are dumped verbatim from
--           sks-canonical (app_data) so CREATE ... IF NOT EXISTS is a true no-op
--           there and an exact create on eq-canonical-internal. The ONLY
--           normalization vs the live SKS shape is the canonical tenant_id
--           DEFAULT (app_metadata claim) + the standard tenant-isolation RLS
--           policy + updated_at trigger, applied to match every other app_data
--           table (0001/0002 convention). The out-of-band SKS tables were created
--           without the tenant_id default; the ALTER ... SET DEFAULT below
--           converges them. Writers (canonical-api, intake) always pass tenant_id
--           explicitly, so the default is defence-in-depth only.
--
-- Consumer: EQ Service write-syncs these via Shell canonical-api (service-role).
--           NOTE: canonical-api does not yet expose assets/asset_test_results/
--           asset_defects as PUT resources — that API catch-up is a separate
--           change (see reconciliation plan). This migration only establishes the
--           schema; it does not wire the write path.
--
-- Order:    service_visits is created first — asset_test_results, asset_defects,
--           and service_task_completions all FK to it. assets + sites + staff come
--           from 0001/0002.
--
-- Idempotent + forward-only. Do NOT edit after it has been applied to any tenant;
-- the runner skips by filename and will not re-apply an edited file.

BEGIN;

SET LOCAL search_path = app_data, public;

-- ──────────────────────────────────────────────────────────────────────
-- service_visits  (parent — declared before the tables that FK to it)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.service_visits (
  visit_id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id        varchar(64),
  site_id            uuid NOT NULL,
  scheduled_date     date NOT NULL,
  actual_date        date,
  crew_lead_id       uuid,
  client_job_code    varchar(100),
  status             varchar(32) NOT NULL DEFAULT 'planned',
  expected_assets    integer,
  expected_circuits  integer,
  logistics_notes    text,
  intake_id          uuid,
  imported_at        timestamptz DEFAULT now(),
  imported_from      text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  CONSTRAINT service_visits_pkey PRIMARY KEY (visit_id),
  CONSTRAINT service_visits_site_id_fkey      FOREIGN KEY (site_id)      REFERENCES app_data.sites(site_id),
  CONSTRAINT service_visits_crew_lead_id_fkey FOREIGN KEY (crew_lead_id) REFERENCES app_data.staff(staff_id),
  CONSTRAINT service_visits_status_check CHECK (
    (status)::text = ANY ((ARRAY['planned','in_progress','complete','cancelled'])::text[])
  )
);

CREATE INDEX IF NOT EXISTS service_visits_site_date_idx
  ON app_data.service_visits (tenant_id, site_id, scheduled_date);
CREATE INDEX IF NOT EXISTS service_visits_tenant_status_idx
  ON app_data.service_visits (tenant_id, status, scheduled_date);
CREATE UNIQUE INDEX IF NOT EXISTS service_visits_tenant_external_id_uidx
  ON app_data.service_visits (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- asset_test_results
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.asset_test_results (
  result_id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id          varchar(64),
  asset_id             uuid NOT NULL,
  visit_id             uuid,
  test_type            varchar(100) NOT NULL,
  test_date            date NOT NULL,
  tested_by_id         uuid,
  tested_by_external   varchar(200),
  licence_number       varchar(64),
  pass_fail            varchar(32) NOT NULL,
  raw_values           jsonb,
  action_taken_if_fail text,
  test_cert_reference  varchar(100),
  notes                text,
  intake_id            uuid,
  imported_at          timestamptz DEFAULT now(),
  imported_from        text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  CONSTRAINT asset_test_results_pkey PRIMARY KEY (result_id),
  CONSTRAINT asset_test_results_asset_id_fkey     FOREIGN KEY (asset_id)     REFERENCES app_data.assets(asset_id),
  CONSTRAINT asset_test_results_tested_by_id_fkey FOREIGN KEY (tested_by_id) REFERENCES app_data.staff(staff_id),
  CONSTRAINT asset_test_results_visit_id_fkey     FOREIGN KEY (visit_id)     REFERENCES app_data.service_visits(visit_id),
  CONSTRAINT asset_test_results_pass_fail_check CHECK (
    (pass_fail)::text = ANY ((ARRAY['pass','fail','partial','inconclusive'])::text[])
  )
);

CREATE INDEX IF NOT EXISTS asset_test_results_asset_date_idx
  ON app_data.asset_test_results (tenant_id, asset_id, test_date DESC);
CREATE INDEX IF NOT EXISTS asset_test_results_asset_type_date_idx
  ON app_data.asset_test_results (tenant_id, asset_id, test_type, test_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS asset_test_results_tenant_external_id_uidx
  ON app_data.asset_test_results (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- asset_defects
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.asset_defects (
  defect_id         uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  external_id       varchar(64),
  asset_id          uuid NOT NULL,
  visit_id          uuid,
  raised_date       date NOT NULL,
  raised_by_id      uuid,
  severity          varchar(32) NOT NULL,
  description       text NOT NULL,
  status            varchar(32) NOT NULL DEFAULT 'open',
  resolution_date   date,
  resolved_by_id    uuid,
  resolution_notes  text,
  estimated_cost    numeric(12,2),
  actual_cost       numeric(12,2),
  photo_attachments jsonb DEFAULT '[]'::jsonb,
  intake_id         uuid,
  imported_at       timestamptz DEFAULT now(),
  imported_from     text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  CONSTRAINT asset_defects_pkey PRIMARY KEY (defect_id),
  CONSTRAINT asset_defects_asset_id_fkey       FOREIGN KEY (asset_id)       REFERENCES app_data.assets(asset_id),
  CONSTRAINT asset_defects_raised_by_id_fkey   FOREIGN KEY (raised_by_id)   REFERENCES app_data.staff(staff_id),
  CONSTRAINT asset_defects_resolved_by_id_fkey FOREIGN KEY (resolved_by_id) REFERENCES app_data.staff(staff_id),
  CONSTRAINT asset_defects_visit_id_fkey       FOREIGN KEY (visit_id)       REFERENCES app_data.service_visits(visit_id),
  CONSTRAINT asset_defects_severity_check CHECK (
    (severity)::text = ANY ((ARRAY['critical','high','medium','low'])::text[])
  ),
  CONSTRAINT asset_defects_status_check CHECK (
    (status)::text = ANY ((ARRAY['open','in_progress','resolved','deferred','no_action'])::text[])
  )
);

CREATE INDEX IF NOT EXISTS asset_defects_asset_status_idx
  ON app_data.asset_defects (tenant_id, asset_id, status, raised_date DESC);
CREATE INDEX IF NOT EXISTS asset_defects_tenant_severity_status_idx
  ON app_data.asset_defects (tenant_id, severity, status, raised_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS asset_defects_tenant_external_id_uidx
  ON app_data.asset_defects (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- service_task_completions
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.service_task_completions (
  completion_id  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid,
  visit_id       uuid NOT NULL,
  asset_id       uuid NOT NULL,
  task_type      varchar(100) NOT NULL,
  completed      boolean NOT NULL DEFAULT false,
  completed_at   timestamptz,
  tech_id        uuid,
  result         varchar(32),
  notes          text,
  intake_id      uuid,
  imported_at    timestamptz DEFAULT now(),
  imported_from  text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  CONSTRAINT service_task_completions_pkey PRIMARY KEY (completion_id),
  CONSTRAINT service_task_completions_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES app_data.service_visits(visit_id),
  CONSTRAINT service_task_completions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES app_data.assets(asset_id),
  CONSTRAINT service_task_completions_tech_id_fkey  FOREIGN KEY (tech_id)  REFERENCES app_data.staff(staff_id),
  CONSTRAINT service_task_completions_result_check CHECK (
    result IS NULL OR (result)::text = ANY ((ARRAY['pass','fail','partial','not_applicable','deferred'])::text[])
  )
);

CREATE INDEX IF NOT EXISTS service_task_completions_asset_idx
  ON app_data.service_task_completions (tenant_id, asset_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS service_task_completions_visit_idx
  ON app_data.service_task_completions (tenant_id, visit_id);
CREATE UNIQUE INDEX IF NOT EXISTS service_task_completions_visit_asset_task_uidx
  ON app_data.service_task_completions (visit_id, asset_id, task_type);

-- ──────────────────────────────────────────────────────────────────────
-- Normalize tenant_id DEFAULT (the out-of-band SKS tables were created
-- without it). No-op on freshly created tables above; converges SKS.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE app_data.service_visits           ALTER COLUMN tenant_id SET DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid;
ALTER TABLE app_data.asset_test_results       ALTER COLUMN tenant_id SET DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid;
ALTER TABLE app_data.asset_defects            ALTER COLUMN tenant_id SET DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid;
ALTER TABLE app_data.service_task_completions ALTER COLUMN tenant_id SET DEFAULT (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid;

-- ──────────────────────────────────────────────────────────────────────
-- Grants — explicit (0001's ALTER DEFAULT PRIVILEGES covers tables created
-- after it, but we grant explicitly to match the baseline's belt-and-braces).
-- ──────────────────────────────────────────────────────────────────────

GRANT ALL ON
  app_data.service_visits,
  app_data.asset_test_results,
  app_data.asset_defects,
  app_data.service_task_completions
TO service_role;

-- ──────────────────────────────────────────────────────────────────────
-- RLS — defence in depth, app_metadata tenant scope (canonical convention).
-- DROP + CREATE so the policy is corrected idempotently on every tenant.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE app_data.service_visits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.asset_test_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.asset_defects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.service_task_completions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'service_visits', 'asset_test_results', 'asset_defects', 'service_task_completions'
  ]
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %I_tenant_isolation ON app_data.%I;
      CREATE POLICY %I_tenant_isolation
        ON app_data.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid)
        WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid);
    $f$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────
-- updated_at triggers (app_data.touch_updated_at() defined in 0001).
-- ──────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'service_visits', 'asset_test_results', 'asset_defects', 'service_task_completions'
  ]
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS %I_touch_updated_at ON app_data.%I;
      CREATE TRIGGER %I_touch_updated_at
        BEFORE UPDATE ON app_data.%I
        FOR EACH ROW
        EXECUTE FUNCTION app_data.touch_updated_at();
    $f$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- Self-record (the runner also records by filename; this keeps the migration
-- safe to apply manually via MCP, matching 0013's pattern).
INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0020_service_cmms', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
