-- =============================================================================
-- ROLLBACK for migration 0072 (testing_checks → maintenance_checks merge)
-- =============================================================================
--
-- Reverses the migration. Safe to run as long as:
--   - No new test-bench checks (kind in acb/nsx/general) have been created via
--     the new maintenance_checks code path AFTER the migration ran. New rows
--     of those kinds would be lost on rollback (they don't exist in the old
--     testing_checks table because we DROP'd it).
--   - The application code that writes to maintenance_checks (with kind set)
--     has NOT been deployed yet, OR has been reverted before this rollback.
--
-- If new test-bench checks have been created post-migration, run the manual
-- back-copy block at the bottom BEFORE running this rollback.
--
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop the view + new FK constraints + new RLS policy
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.testing_checks;

ALTER TABLE public.acb_tests
  DROP CONSTRAINT IF EXISTS acb_tests_testing_check_id_fkey;

ALTER TABLE public.nsx_tests
  DROP CONSTRAINT IF EXISTS nsx_tests_testing_check_id_fkey;

DROP POLICY IF EXISTS "Writers can create checks" ON public.maintenance_checks;

-- -----------------------------------------------------------------------------
-- 2. Re-create testing_checks TABLE (matching original 0032 schema)
-- -----------------------------------------------------------------------------

CREATE TABLE public.testing_checks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  job_plan_id uuid references public.job_plans(id) on delete set null,
  name        text not null,
  check_type  text not null default 'acb' check (check_type in ('acb', 'nsx', 'general')),
  frequency   text,
  month       integer check (month between 1 and 12),
  year        integer,
  status      text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'complete', 'cancelled')),
  created_by  uuid references auth.users(id) on delete set null,
  notes       text,
  is_active   boolean not null default true,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

CREATE INDEX idx_testing_checks_tenant       ON public.testing_checks(tenant_id);
CREATE INDEX idx_testing_checks_site         ON public.testing_checks(site_id);
CREATE INDEX idx_testing_checks_status       ON public.testing_checks(status);
CREATE INDEX idx_testing_checks_deleted_at   ON public.testing_checks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_testing_checks_created_by   ON public.testing_checks(created_by);
CREATE INDEX idx_testing_checks_job_plan_id  ON public.testing_checks(job_plan_id);

CREATE TRIGGER set_updated_at_testing_checks
  BEFORE UPDATE ON public.testing_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_deleted_at_testing_checks
  BEFORE UPDATE ON public.testing_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_deleted_at();

ALTER TABLE public.testing_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view testing checks"
  ON public.testing_checks FOR SELECT
  USING (tenant_id = ANY (public.get_user_tenant_ids()));

CREATE POLICY "Writers can manage testing checks"
  ON public.testing_checks FOR ALL
  USING (tenant_id = ANY (public.get_user_tenant_ids()))
  WITH CHECK (tenant_id = ANY (public.get_user_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 3. Restore data from maintenance_checks back into testing_checks
-- -----------------------------------------------------------------------------

INSERT INTO public.testing_checks (
  id, tenant_id, site_id, job_plan_id, name, check_type, frequency,
  month, year, status, created_by, notes, is_active, deleted_at,
  created_at, updated_at
)
SELECT
  mc.id, mc.tenant_id, mc.site_id, mc.job_plan_id, mc.custom_name,
  mc.kind,
  mc.frequency,
  EXTRACT(MONTH FROM mc.due_date)::int,
  EXTRACT(YEAR  FROM mc.due_date)::int,
  mc.status, mc.created_by, mc.notes, mc.is_active, mc.deleted_at,
  mc.created_at, mc.updated_at
FROM public.maintenance_checks mc
WHERE mc.kind IN ('acb', 'nsx', 'general')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Restore the original FK constraints on acb_tests + nsx_tests
-- -----------------------------------------------------------------------------

ALTER TABLE public.acb_tests
  ADD CONSTRAINT acb_tests_testing_check_id_fkey
    FOREIGN KEY (testing_check_id)
    REFERENCES public.testing_checks(id)
    ON DELETE SET NULL;

ALTER TABLE public.nsx_tests
  ADD CONSTRAINT nsx_tests_testing_check_id_fkey
    FOREIGN KEY (testing_check_id)
    REFERENCES public.testing_checks(id)
    ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 5. Remove migrated rows from maintenance_checks
-- -----------------------------------------------------------------------------

DELETE FROM public.maintenance_checks
  WHERE kind IN ('acb', 'nsx', 'general');

-- -----------------------------------------------------------------------------
-- 6. Restore the original maintenance_checks INSERT policy
-- -----------------------------------------------------------------------------

CREATE POLICY "Admin and supervisor can create checks"
  ON public.maintenance_checks FOR INSERT
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = maintenance_checks.tenant_id
        AND tenant_members.is_active = true
        AND tenant_members.role IN ('super_admin', 'admin', 'supervisor')
    )
  );

-- -----------------------------------------------------------------------------
-- 7. Restore NOT NULL on job_plan_id (only if no nulls exist)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.maintenance_checks WHERE job_plan_id IS NULL) THEN
    RAISE NOTICE 'Skipping NOT NULL restore on job_plan_id — % rows are null. Resolve before re-applying constraint.',
      (SELECT COUNT(*) FROM public.maintenance_checks WHERE job_plan_id IS NULL);
  ELSE
    ALTER TABLE public.maintenance_checks
      ALTER COLUMN job_plan_id SET NOT NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Drop the columns and indexes added by 0072
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_maintenance_checks_kind;
DROP INDEX IF EXISTS public.idx_maintenance_checks_created_by;

ALTER TABLE public.maintenance_checks DROP COLUMN IF EXISTS kind;
ALTER TABLE public.maintenance_checks DROP COLUMN IF EXISTS created_by;

-- -----------------------------------------------------------------------------
-- 9. Restore audit_logs.entity_type comment to default
-- -----------------------------------------------------------------------------

COMMENT ON COLUMN public.audit_logs.entity_type IS NULL;

COMMIT;

-- =============================================================================
-- Manual back-copy for rows created post-migration
-- =============================================================================
--
-- Run this BEFORE the rollback if any new test-bench checks were created via
-- the new code path. Replace <MIGRATION_TIMESTAMP> with the actual apply time.
--
-- INSERT INTO public.testing_checks (
--   id, tenant_id, site_id, job_plan_id, name, check_type, frequency,
--   month, year, status, created_by, notes, is_active, deleted_at,
--   created_at, updated_at
-- )
-- SELECT
--   mc.id, mc.tenant_id, mc.site_id, mc.job_plan_id, mc.custom_name,
--   mc.kind,
--   mc.frequency,
--   EXTRACT(MONTH FROM mc.due_date)::int,
--   EXTRACT(YEAR  FROM mc.due_date)::int,
--   mc.status, mc.created_by, mc.notes, mc.is_active, mc.deleted_at,
--   mc.created_at, mc.updated_at
-- FROM public.maintenance_checks mc
-- WHERE mc.kind IN ('acb', 'nsx', 'general')
--   AND mc.created_at > '<MIGRATION_TIMESTAMP>'
-- ON CONFLICT (id) DO NOTHING;
