-- Migration: 0064_eq_ops_schema_extension
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Extend the quotes/jobs canonical schema to support the full EQ Ops
--            lifecycle (quote → won → PO matched → active job → ready to invoice),
--            Coupa PO matching, client grouping (Equinix 5-entity model), and
--            append-only job notes.
--
--            Three new tables:
--              app_data.client_groups          — named group (e.g. "Equinix")
--              app_data.client_group_members   — customer → group mapping + site codes
--              app_data.job_notes              — append-only notes log on a quote/job
--
--            Column additions:
--              app_data.quote  — workbench_job_no, po_number, coupa_entity,
--                                client_accepted_at/by, client_declined_at,
--                                loss_reason, validity_days, payment_terms, expires_at
--              app_data.jobs   — workbench_job_no, po_number, coupa_entity, description
--
--            Status CHECK replacement on quote + quote_status_history:
--              Old taxonomy ('draft','sent','accepted','rejected','expired','superseded')
--              replaced with the real EQ Ops lifecycle (lowercase-hyphenated canonical form).
--
-- Idempotent: all DDL uses IF NOT EXISTS / DO $$ IF EXISTS checks.
-- The runner (scripts/migrate-tenants.mjs) is the SINGLE writer of _eq_migrations —
-- this file inserts NO ledger row of its own.

-- ============================================================================
-- 1. Extend app_data.quote
-- ============================================================================

-- 1a. Drop old status CHECK (only allowed canonical values that don't match real data)
ALTER TABLE app_data.quote
  DROP CONSTRAINT IF EXISTS quote_status_check;

-- 1b. Add new status CHECK covering the full EQ Ops lifecycle
--     Lowercase-hyphenated canonical form. Mapping from Flask title-case on copy:
--       "Draft"                → draft
--       "Submitted"            → submitted
--       "Verbal Win"           → verbal-win
--       "Won-Awaiting Job No"  → won-awaiting-job-no  (transitional; maps to po-matched)
--       "Won-Job Created"      → won-job-created      (transitional; maps to active)
--       "Lost"                 → lost
--     New EQ Ops statuses:
--       po-matched, active, complete, ready-to-invoice
--     Retained from old schema:
--       expired, superseded, cancelled
ALTER TABLE app_data.quote
  ADD CONSTRAINT quote_status_check CHECK (status IN (
    'draft', 'submitted', 'verbal-win',
    'won-awaiting-job-no', 'won-job-created',
    'po-matched', 'active', 'complete', 'ready-to-invoice',
    'lost', 'cancelled', 'expired', 'superseded'
  ));

-- 1c. Add missing columns (all idempotent via separate DO blocks)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'workbench_job_no')
  THEN ALTER TABLE app_data.quote ADD COLUMN workbench_job_no text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'po_number')
  THEN ALTER TABLE app_data.quote ADD COLUMN po_number text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'coupa_entity')
  THEN ALTER TABLE app_data.quote ADD COLUMN coupa_entity text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'client_accepted_at')
  THEN ALTER TABLE app_data.quote ADD COLUMN client_accepted_at timestamptz NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'client_accepted_by')
  THEN ALTER TABLE app_data.quote ADD COLUMN client_accepted_by text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'client_declined_at')
  THEN ALTER TABLE app_data.quote ADD COLUMN client_declined_at timestamptz NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'loss_reason')
  THEN ALTER TABLE app_data.quote ADD COLUMN loss_reason text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'validity_days')
  THEN ALTER TABLE app_data.quote ADD COLUMN validity_days integer NOT NULL DEFAULT 30; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'payment_terms')
  THEN ALTER TABLE app_data.quote ADD COLUMN payment_terms text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'quote' AND column_name = 'expires_at')
  THEN ALTER TABLE app_data.quote ADD COLUMN expires_at timestamptz NULL; END IF;
END $$;

-- Index: quote lookup by workbench job number (sparse — most rows will be null)
CREATE INDEX IF NOT EXISTS quote_workbench_job_no_idx
  ON app_data.quote (tenant_id, workbench_job_no)
  WHERE workbench_job_no IS NOT NULL;

-- ============================================================================
-- 2. Relax status CHECK on quote_status_history to match quote
-- ============================================================================

ALTER TABLE app_data.quote_status_history
  DROP CONSTRAINT IF EXISTS qsh_to_status_check;

ALTER TABLE app_data.quote_status_history
  DROP CONSTRAINT IF EXISTS qsh_from_status_check;

ALTER TABLE app_data.quote_status_history
  ADD CONSTRAINT qsh_to_status_check CHECK (to_status IN (
    'draft', 'submitted', 'verbal-win',
    'won-awaiting-job-no', 'won-job-created',
    'po-matched', 'active', 'complete', 'ready-to-invoice',
    'lost', 'cancelled', 'expired', 'superseded'
  ));

ALTER TABLE app_data.quote_status_history
  ADD CONSTRAINT qsh_from_status_check CHECK (from_status IS NULL OR from_status IN (
    'draft', 'submitted', 'verbal-win',
    'won-awaiting-job-no', 'won-job-created',
    'po-matched', 'active', 'complete', 'ready-to-invoice',
    'lost', 'cancelled', 'expired', 'superseded'
  ));

-- ============================================================================
-- 3. Extend app_data.jobs
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'jobs' AND column_name = 'workbench_job_no')
  THEN ALTER TABLE app_data.jobs ADD COLUMN workbench_job_no text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'jobs' AND column_name = 'po_number')
  THEN ALTER TABLE app_data.jobs ADD COLUMN po_number text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'jobs' AND column_name = 'coupa_entity')
  THEN ALTER TABLE app_data.jobs ADD COLUMN coupa_entity text NULL; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'jobs' AND column_name = 'description')
  THEN ALTER TABLE app_data.jobs ADD COLUMN description text NULL; END IF;
END $$;

-- ============================================================================
-- 4. app_data.client_groups — named client group (e.g. "Equinix")
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.client_groups (
  group_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL DEFAULT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
  name        text        NOT NULL,
  slug        text        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NULL,
  updated_by  uuid        NULL,
  CONSTRAINT client_group_name_tenant_uq UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS client_groups_tenant_idx ON app_data.client_groups (tenant_id);

ALTER TABLE app_data.client_groups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'client_groups' AND policyname = 'client_groups_select') THEN
    CREATE POLICY client_groups_select ON app_data.client_groups FOR SELECT TO authenticated
      USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'client_groups' AND policyname = 'client_groups_insert') THEN
    CREATE POLICY client_groups_insert ON app_data.client_groups FOR INSERT TO authenticated
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'client_groups' AND policyname = 'client_groups_update') THEN
    CREATE POLICY client_groups_update ON app_data.client_groups FOR UPDATE TO authenticated
      USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;

-- ============================================================================
-- 5. app_data.client_group_members — customer → group + site code mapping
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.client_group_members (
  member_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL DEFAULT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
  group_id    uuid        NOT NULL REFERENCES app_data.client_groups(group_id) ON DELETE CASCADE,
  customer_id uuid        NOT NULL REFERENCES app_data.customers(customer_id) ON DELETE CASCADE,
  site_codes  text[]      NULL,     -- e.g. ARRAY['SY1','SY2','SY3'] — used for Coupa PO resolution
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_group_members_uq UNIQUE (group_id, customer_id)
);

CREATE INDEX IF NOT EXISTS client_group_members_group_idx    ON app_data.client_group_members (group_id);
CREATE INDEX IF NOT EXISTS client_group_members_customer_idx ON app_data.client_group_members (customer_id);
CREATE INDEX IF NOT EXISTS client_group_members_tenant_idx   ON app_data.client_group_members (tenant_id);

ALTER TABLE app_data.client_group_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'client_group_members' AND policyname = 'client_group_members_select') THEN
    CREATE POLICY client_group_members_select ON app_data.client_group_members FOR SELECT TO authenticated
      USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'client_group_members' AND policyname = 'client_group_members_insert') THEN
    CREATE POLICY client_group_members_insert ON app_data.client_group_members FOR INSERT TO authenticated
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'client_group_members' AND policyname = 'client_group_members_update') THEN
    CREATE POLICY client_group_members_update ON app_data.client_group_members FOR UPDATE TO authenticated
      USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;

-- ============================================================================
-- 6. app_data.job_notes — append-only notes log (emails, calls, site visits)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.job_notes (
  note_id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL DEFAULT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
  quote_id            uuid        NULL REFERENCES app_data.quote(quote_id) ON DELETE CASCADE,
  job_id              uuid        NULL REFERENCES app_data.jobs(job_id) ON DELETE CASCADE,
  note_type           text        NOT NULL DEFAULT 'manual',
  body                text        NOT NULL,
  created_by_initials text        NULL,
  created_by_user_id  uuid        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_notes_has_anchor CHECK (quote_id IS NOT NULL OR job_id IS NOT NULL),
  CONSTRAINT job_notes_type_check CHECK (note_type IN ('manual','email','call','site-visit','system'))
);

CREATE INDEX IF NOT EXISTS job_notes_quote_idx  ON app_data.job_notes (quote_id, created_at DESC) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_notes_job_idx    ON app_data.job_notes (job_id,   created_at DESC) WHERE job_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_notes_tenant_idx ON app_data.job_notes (tenant_id, created_at DESC);

ALTER TABLE app_data.job_notes ENABLE ROW LEVEL SECURITY;

-- SELECT + INSERT only — append-only, no update/delete for authenticated users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'job_notes' AND policyname = 'job_notes_select') THEN
    CREATE POLICY job_notes_select ON app_data.job_notes FOR SELECT TO authenticated
      USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_data' AND tablename = 'job_notes' AND policyname = 'job_notes_insert') THEN
    CREATE POLICY job_notes_insert ON app_data.job_notes FOR INSERT TO authenticated
      WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
  END IF;
END $$;

-- ============================================================================
-- 7. Register new entities in eq_schema_registry
-- ============================================================================

INSERT INTO shell_control.eq_schema_registry (entity, module, version, schema_json, description, is_current)
VALUES
  ('client_groups',         'quotes', '1.0.0', '{"x-eq-entity":"client_groups","x-eq-module":"quotes","x-eq-version":"1.0.0","type":"object","description":"Named client group (e.g. Equinix)."}'::jsonb,         'Named client group.',       true),
  ('client_group_members',  'quotes', '1.0.0', '{"x-eq-entity":"client_group_members","x-eq-module":"quotes","x-eq-version":"1.0.0","type":"object","description":"Customer to client group mapping."}'::jsonb,  'Client group membership.',  true),
  ('job_notes',             'quotes', '1.0.0', '{"x-eq-entity":"job_notes","x-eq-module":"quotes","x-eq-version":"1.0.0","type":"object","description":"Append-only notes log on a quote or job."}'::jsonb,      'Job notes log.',            true)
ON CONFLICT (entity, version) DO UPDATE
  SET module = excluded.module, description = excluded.description, is_current = excluded.is_current;
