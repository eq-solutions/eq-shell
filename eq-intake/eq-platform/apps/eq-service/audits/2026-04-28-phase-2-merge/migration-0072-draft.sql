-- =============================================================================
-- DRAFT — NOT APPLIED, NOT COMMITTED
-- Migration 0072: Merge testing_checks into maintenance_checks
-- =============================================================================
--
-- Goal: Collapse the two parallel "check" concepts into one. After this runs:
--   - All testing_checks rows live as maintenance_checks rows (same UUIDs).
--   - acb_tests.testing_check_id and nsx_tests.testing_check_id now point at
--     maintenance_checks.id (FK repointed).
--   - The testing_checks TABLE is gone, replaced by a read-only VIEW backed
--     by maintenance_checks. Existing /admin/archive reads keep working;
--     writes fail loudly so caller code knows to migrate.
--   - RLS allows technicians to create checks (matches pre-merge behaviour
--     and aligns with canWrite() at the application layer).
--   - audit_logs history left intact — the entity_type='testing_check' rows
--     stay as-is, and a column comment explains why for future readers.
--
-- Decisions locked 2026-04-28 working session — see README.md in this folder.
--
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extend maintenance_checks with the columns testing_checks needs
-- -----------------------------------------------------------------------------

-- `kind` distinguishes the check's domain. Default 'maintenance' preserves
-- existing rows. testing_checks rows arrive with 'acb', 'nsx', or 'general'.
-- 'rcd' reserved for future use (RCD checks are already maintenance_checks
-- after PR #21, but flagging them by kind makes the Site Visit Report bundle
-- query trivial).
ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'maintenance'
    CHECK (kind IN ('maintenance', 'acb', 'nsx', 'rcd', 'general'));

COMMENT ON COLUMN public.maintenance_checks.kind IS
  'Domain of the check. ''maintenance'' = standard PPM (default for pre-merge rows). ''acb''/''nsx''/''rcd''/''general'' = test-bench checks migrated from testing_checks. Drives the Site Visit Report bundling query.';

-- testing_checks tracks who created the row separately from assigned_to.
-- maintenance_checks doesn't currently — add it for parity.
ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.maintenance_checks.created_by IS
  'User who created the row. Pre-merge rows are null (look up via audit_logs). Required for migrated testing_checks rows.';

CREATE INDEX IF NOT EXISTS idx_maintenance_checks_kind
  ON public.maintenance_checks(tenant_id, kind);

CREATE INDEX IF NOT EXISTS idx_maintenance_checks_created_by
  ON public.maintenance_checks(created_by) WHERE created_by IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Lift the NOT NULL on maintenance_checks.job_plan_id
-- -----------------------------------------------------------------------------
--
-- Multi-plan checks already pass null at the application layer; the constraint
-- was an oversight. Drop it before backfilling testing_checks (some of which
-- have null job_plan_id).

ALTER TABLE public.maintenance_checks
  ALTER COLUMN job_plan_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Backfill: copy every testing_checks row into maintenance_checks
-- -----------------------------------------------------------------------------
--
-- IDs preserved so acb_tests.testing_check_id and nsx_tests.testing_check_id
-- continue to resolve correctly after the FK is repointed.
--
-- Date derivation: testing_checks stores month + year. maintenance_checks
-- requires start_date and due_date. Use first-of-month for both — visit
-- dates inside that month aren't tracked on testing_checks, so this is the
-- safest default.
--
-- Frequency: coerce nulls or unknown values to 'annual' (most common default).

INSERT INTO public.maintenance_checks (
  id,
  tenant_id,
  site_id,
  job_plan_id,
  custom_name,
  kind,
  frequency,
  status,
  start_date,
  due_date,
  created_by,
  notes,
  is_active,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  tc.id,
  tc.tenant_id,
  tc.site_id,
  tc.job_plan_id,
  tc.name,
  tc.check_type,
  CASE
    WHEN tc.frequency IN ('monthly','quarterly','semi_annual','annual','2yr','3yr','5yr','8yr','10yr')
      THEN tc.frequency
    ELSE 'annual'
  END,
  tc.status,
  make_date(
    COALESCE(tc.year,  EXTRACT(YEAR  FROM tc.created_at)::int),
    COALESCE(tc.month, EXTRACT(MONTH FROM tc.created_at)::int),
    1
  ),
  make_date(
    COALESCE(tc.year,  EXTRACT(YEAR  FROM tc.created_at)::int),
    COALESCE(tc.month, EXTRACT(MONTH FROM tc.created_at)::int),
    1
  ),
  tc.created_by,
  tc.notes,
  tc.is_active,
  tc.deleted_at,
  tc.created_at,
  tc.updated_at
FROM public.testing_checks tc
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Drop FK constraints on acb_tests + nsx_tests (pointing at testing_checks)
-- -----------------------------------------------------------------------------
--
-- Must happen BEFORE we drop the testing_checks table. The data column
-- (testing_check_id) stays — only the constraint is dropped here. New
-- constraint pointing at maintenance_checks added in step 7.

ALTER TABLE public.acb_tests
  DROP CONSTRAINT IF EXISTS acb_tests_testing_check_id_fkey;

ALTER TABLE public.nsx_tests
  DROP CONSTRAINT IF EXISTS nsx_tests_testing_check_id_fkey;

-- -----------------------------------------------------------------------------
-- 5. Drop the testing_checks TABLE
-- -----------------------------------------------------------------------------
--
-- Data is already in maintenance_checks (step 3). FKs are dropped (step 4).
-- Triggers (set_updated_at_testing_checks, set_deleted_at_testing_checks)
-- drop with the table.

DROP TABLE IF EXISTS public.testing_checks;

-- -----------------------------------------------------------------------------
-- 6. Replace with a read-only VIEW
-- -----------------------------------------------------------------------------
--
-- Reads keep working (e.g. /admin/archive helpers.ts queries that haven't
-- been refactored yet). Writes fail loudly because the view is not updatable
-- without explicit INSTEAD OF triggers — we deliberately don't add them.
-- The caller sees an error like "cannot insert into view 'testing_checks'"
-- and the right fix is to migrate the call site to maintenance_checks.
--
-- security_invoker = true so the view evaluates RLS as the calling user
-- (PG 15+ behaviour). Without this it would run as the view owner and
-- bypass tenant isolation.

CREATE VIEW public.testing_checks
  WITH (security_invoker = true)
  AS
  SELECT
    mc.id,
    mc.tenant_id,
    mc.site_id,
    mc.job_plan_id,
    mc.custom_name                              AS name,
    mc.kind                                     AS check_type,
    mc.frequency,
    EXTRACT(MONTH FROM mc.due_date)::int        AS month,
    EXTRACT(YEAR  FROM mc.due_date)::int        AS year,
    mc.status,
    mc.created_by,
    mc.notes,
    mc.is_active,
    mc.deleted_at,
    mc.created_at,
    mc.updated_at
  FROM public.maintenance_checks mc
  WHERE mc.kind IN ('acb', 'nsx', 'general');

COMMENT ON VIEW public.testing_checks IS
  'DEPRECATED 2026-04-28 — read-only view backed by maintenance_checks (kind in [acb,nsx,general]). Writes fail by design. Existed to keep /admin/archive helpers.ts working during the transition. Drop in a follow-up migration once nothing reads it.';

-- -----------------------------------------------------------------------------
-- 7. Add new FK constraints on acb_tests + nsx_tests (pointing at maintenance_checks)
-- -----------------------------------------------------------------------------
--
-- Same column name (testing_check_id) — rename to check_id ships in a
-- follow-up PR per Q3 decision. ON DELETE SET NULL preserved.

ALTER TABLE public.acb_tests
  ADD CONSTRAINT acb_tests_testing_check_id_fkey
    FOREIGN KEY (testing_check_id)
    REFERENCES public.maintenance_checks(id)
    ON DELETE SET NULL;

ALTER TABLE public.nsx_tests
  ADD CONSTRAINT nsx_tests_testing_check_id_fkey
    FOREIGN KEY (testing_check_id)
    REFERENCES public.maintenance_checks(id)
    ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 8. RLS — allow technicians to create checks (Q1 decision)
-- -----------------------------------------------------------------------------
--
-- Pre-merge: testing_checks INSERT was open to any tenant member; technicians
-- could create checks via /testing. maintenance_checks INSERT was supervisor+
-- only. After the merge, technicians would lose check-creation. Decision: add
-- 'technician' to the maintenance_checks INSERT policy. Aligns RLS with the
-- application's canWrite() helper.

DROP POLICY IF EXISTS "Admin and supervisor can create checks" ON public.maintenance_checks;

CREATE POLICY "Writers can create checks"
  ON public.maintenance_checks FOR INSERT
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = maintenance_checks.tenant_id
        AND tenant_members.is_active = true
        AND tenant_members.role IN ('super_admin', 'admin', 'supervisor', 'technician')
    )
  );

-- -----------------------------------------------------------------------------
-- 9. Document the audit_logs entity_type values (Q4 decision)
-- -----------------------------------------------------------------------------
--
-- Historical entries with entity_type='testing_check' stay intact — backfilling
-- would rewrite history and lose audit fidelity. Future entries use
-- 'maintenance_check' (the existing convention). The comment explains for
-- future readers why both values appear.

COMMENT ON COLUMN public.audit_logs.entity_type IS
  'Domain entity the action operated on. Standard values: maintenance_check, defect, asset, site, customer, job_plan, instrument, etc. Note: ''testing_check'' values appear on entries from before 2026-04-28 — testing_checks was merged into maintenance_checks in migration 0072 and historical audit entries were intentionally NOT backfilled to preserve audit-trail fidelity. New writes use ''maintenance_check'' regardless of the row''s kind.';

COMMIT;

-- =============================================================================
-- Post-merge verification queries (run separately, not part of the migration)
-- =============================================================================
--
-- 1. Row counts match:
--    SELECT COUNT(*) FROM testing_checks WHERE is_active = true;  -- via view now
--    SELECT COUNT(*) FROM maintenance_checks WHERE kind IN ('acb','nsx','general') AND is_active = true;
--    -- These should be equal.
--
-- 2. Every test still resolves to a check:
--    SELECT COUNT(*) FROM acb_tests
--      WHERE testing_check_id IS NOT NULL
--        AND testing_check_id NOT IN (SELECT id FROM maintenance_checks);
--    -- Should be 0.
--
--    SELECT COUNT(*) FROM nsx_tests
--      WHERE testing_check_id IS NOT NULL
--        AND testing_check_id NOT IN (SELECT id FROM maintenance_checks);
--    -- Should be 0.
--
-- 3. Sanity-check the kind distribution:
--    SELECT kind, COUNT(*) FROM maintenance_checks GROUP BY kind ORDER BY 1;
--
-- 4. View is read-only as expected:
--    INSERT INTO testing_checks (id, tenant_id, site_id, name, check_type)
--      VALUES (gen_random_uuid(), ...);
--    -- Should error: "cannot insert into view 'testing_checks'"
--
-- 5. Technician role can create:
--    -- Run as a technician session:
--    INSERT INTO maintenance_checks (tenant_id, site_id, frequency, start_date, due_date, kind)
--      VALUES (...);
--    -- Should succeed.
