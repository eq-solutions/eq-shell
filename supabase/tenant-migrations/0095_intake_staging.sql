-- Migration: 0095_intake_staging
-- Target:    Per-tenant data plane
-- Purpose:   Durable staging + review queue for intake. Sits in front of the
--            per-module commit RPCs (0005 cards / 0008 service / 0009 quotes /
--            0010 core / 0011 field). Closes the "bad import silently lands in
--            app_data" exposure: parsed rows are staged here with a computed
--            health score + conflict report, a reviewer approves or rejects,
--            and ONLY approved rows are handed to eq_intake_commit_batch_<module>.
--
--            Flow (all writes via service_role through the intake orchestrator;
--            reads via the tenant browser JWT under RLS):
--              1. intake-stage    -> INSERT rows here, status='pending'
--              2. review UI       -> SELECT here (RLS, tenant-scoped)
--              3. intake-approve  -> eq_intake_commit_batch_<module>(approved
--                                    rows), then UPDATE status='committed' and
--                                    stamp committed_id
--              4. intake-reject   -> UPDATE status='rejected', set reject_reason
--
--            No new commit path: approval replays the existing per-module RPC,
--            so the staging layer is purely additive. Staged rows are tenant
--            business data (licence numbers, staff names) so they live on the
--            tenant data plane -- never the shared control plane -- preserving
--            the audit-on-shared / data-on-tenant trade (ARCHITECTURE-V2.md).
--
--            updated_at is stamped explicitly by the orchestrator on every
--            write (service_role) rather than by a trigger -- writes never
--            originate from the browser, so there is no untrusted path that
--            could skip it.

CREATE TABLE IF NOT EXISTS app_data.eq_intake_staging (
  staging_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Batch grouping. intake_id ties to shell_control.eq_intake_events on the
  -- control plane (soft ref -- different DB, so not a FK). One intake_id ==
  -- one staged batch.
  intake_id         uuid NOT NULL,
  tenant_id         uuid NOT NULL,

  -- Routing. entity is the canonical name ('licence'); target_table is the
  -- app_data table ('licences'); module selects the commit RPC on approval.
  entity            text NOT NULL,
  target_table      text NOT NULL,
  module            text NOT NULL,

  -- Position in the original parsed batch (stable ordering for the reviewer).
  source_row_index  integer NOT NULL,

  -- The row payload exactly as it would be committed. jsonb_populate_record
  -- inside the commit RPC consumes this verbatim on approval.
  canonical         jsonb NOT NULL,

  -- Health + conflicts, computed once at stage time by the orchestrator.
  --   row_health    0..1 (1.0 = clean)
  --   health_flags  [{ field, severity, reason }]
  --   conflicts     [{ type, match_id, match_summary, on }]
  row_health        numeric NOT NULL DEFAULT 1.0 CHECK (row_health >= 0 AND row_health <= 1),
  health_flags      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  conflicts         jsonb   NOT NULL DEFAULT '[]'::jsonb,

  -- Lifecycle.
  --   pending    -> awaiting review
  --   approved   -> reviewer accepted, commit in flight (transient)
  --   committed  -> handed to commit RPC; committed_id stamped
  --   rejected   -> reviewer declined; reject_reason set
  --   superseded -> a later batch replaced this staged row before commit
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','committed','rejected','superseded')),
  reject_reason     text,
  committed_id      uuid,
  committed_at      timestamptz,

  reviewed_by       text,
  reviewed_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_data.eq_intake_staging IS
  'Intake review queue. Parsed rows land here pending reviewer approval; approved rows replay eq_intake_commit_batch_<module>. Writes via service_role only; tenant reads via RLS.';

-- Batch detail (reviewer opens one intake_id).
CREATE INDEX IF NOT EXISTS eq_intake_staging_batch_idx
  ON app_data.eq_intake_staging (tenant_id, intake_id);

-- Queue listing (pending rows for a tenant) + approve/reject scans.
CREATE INDEX IF NOT EXISTS eq_intake_staging_status_idx
  ON app_data.eq_intake_staging (tenant_id, status);

-- Conflict re-checks scope by destination table.
CREATE INDEX IF NOT EXISTS eq_intake_staging_table_idx
  ON app_data.eq_intake_staging (tenant_id, target_table, status);

-- ----- RLS ----------------------------------------------------------------
-- Reads: a tenant user (browser SKS JWT) may SELECT only their own tenant's
-- staged rows -- mirrors the tenant predicate on every app_data table.
-- Writes: NONE for authenticated. Stage / approve / reject all run through the
-- intake orchestrator under service_role (which bypasses RLS) so the
-- intake.review / intake.commit permission gate cannot be sidestepped by a
-- direct DB write. This is deliberately stricter than the entity tables, which
-- allow authenticated insert/update/delete.
ALTER TABLE app_data.eq_intake_staging ENABLE ROW LEVEL SECURITY;

-- Idempotent: the tenant runner may re-apply this file on a data plane where
-- the table already exists (CREATE POLICY has no IF NOT EXISTS, so guard it).
DROP POLICY IF EXISTS eq_intake_staging_select ON app_data.eq_intake_staging;
CREATE POLICY eq_intake_staging_select ON app_data.eq_intake_staging
  FOR SELECT TO authenticated
  USING (tenant_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text))::uuid);

REVOKE ALL ON app_data.eq_intake_staging FROM PUBLIC, anon;
GRANT SELECT ON app_data.eq_intake_staging TO authenticated;
GRANT ALL    ON app_data.eq_intake_staging TO service_role;

-- NB: no INSERT INTO app_data._eq_migrations here. The tenant runner
-- (scripts/migrate-tenants.mjs) records the ledger row under the full filename
-- on apply; a self-insert would write a duplicate bare-named twin. See
-- SCHEMA-GOVERNANCE.md → "Ledger truth: the runner records, the file does not".
