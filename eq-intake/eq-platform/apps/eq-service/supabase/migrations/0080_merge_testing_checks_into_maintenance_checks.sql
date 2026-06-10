-- =============================================================================
-- Migration 0080: Merge testing_checks into maintenance_checks
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
-- Decisions locked 2026-04-28 working session — see audits/2026-04-28-phase-2-merge/.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend maintenance_checks with the columns testing_checks needs
-- -----------------------------------------------------------------------------

ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'maintenance'
    CHECK (kind IN ('maintenance', 'acb', 'nsx', 'rcd', 'general'));

COMMENT ON COLUMN public.maintenance_checks.kind IS
  'Domain of the check. ''maintenance'' = standard PPM (default for pre-merge rows). ''acb''/''nsx''/''rcd''/''general'' = test-bench checks migrated from testing_checks. Drives the Site Visit Report bundling query.';

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
-- Multi-plan checks already pass null at the application layer; the constraint
-- was an oversight. Drop it before backfilling testing_checks.

ALTER TABLE public.maintenance_checks
  ALTER COLUMN job_plan_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Backfill: copy every testing_checks row into maintenance_checks
-- -----------------------------------------------------------------------------
-- IDs preserved so acb_tests.testing_check_id and nsx_tests.testing_check_id
-- continue to resolve correctly after the FK is repointed.

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

ALTER TABLE public.acb_tests
  DROP CONSTRAINT IF EXISTS acb_tests_testing_check_id_fkey;

ALTER TABLE public.nsx_tests
  DROP CONSTRAINT IF EXISTS nsx_tests_testing_check_id_fkey;

-- -----------------------------------------------------------------------------
-- 5. Drop the testing_checks TABLE
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS public.testing_checks;

-- -----------------------------------------------------------------------------
-- 6. Replace with a read-only VIEW
-- -----------------------------------------------------------------------------
-- Reads keep working. Writes fail loudly because the view is not updatable
-- without explicit INSTEAD OF triggers — we deliberately don't add them.
-- security_invoker = true so RLS evaluates as the calling user.

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

COMMENT ON COLUMN public.audit_logs.entity_type IS
  'Domain entity the action operated on. Standard values: maintenance_check, defect, asset, site, customer, job_plan, instrument, etc. Note: ''testing_check'' values appear on entries from before 2026-04-28 — testing_checks was merged into maintenance_checks in migration 0080 and historical audit entries were intentionally NOT backfilled to preserve audit-trail fidelity. New writes use ''maintenance_check'' regardless of the row''s kind.';
