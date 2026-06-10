-- Migration: 0049_job_plan_aliases
-- Purpose: Store tenant-scoped mappings from external system codes (e.g. Delta/Maximo)
--          to EQ Service job_plans.code. Enables silent auto-normalisation of upstream
--          code drift during Excel work-order imports.
-- Applied: 2026-04-19 via Supabase MCP
-- Rollback:
--   DROP TABLE public.job_plan_aliases CASCADE;

BEGIN;

-- ============================================================
-- 1. TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_plan_aliases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_system  text NOT NULL DEFAULT 'delta'
    CHECK (source_system IN ('delta', 'maximo', 'manual')),
  external_code  text NOT NULL,
  job_plan_id    uuid NOT NULL REFERENCES public.job_plans(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, external_code)
);

COMMENT ON TABLE public.job_plan_aliases IS
  'Maps an external upstream code (e.g. Delta sends "MVSWBD") to the canonical EQ job_plans.code ("MVSWDB") for a tenant. Used by the work-order importer to auto-normalise silently after the first confirmation.';

COMMENT ON COLUMN public.job_plan_aliases.source_system IS
  'Which upstream system produced the external_code. Delta = Equinix Maximo export spreadsheets. Maximo = direct Maximo exports. Manual = user-defined alias.';

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS job_plan_aliases_tenant_idx
  ON public.job_plan_aliases(tenant_id);

CREATE INDEX IF NOT EXISTS job_plan_aliases_job_plan_idx
  ON public.job_plan_aliases(job_plan_id);

-- ============================================================
-- 3. updated_at TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS job_plan_aliases_set_updated_at
  ON public.job_plan_aliases;
CREATE TRIGGER job_plan_aliases_set_updated_at
  BEFORE UPDATE ON public.job_plan_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE public.job_plan_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_plan_aliases_select ON public.job_plan_aliases;
CREATE POLICY job_plan_aliases_select
  ON public.job_plan_aliases FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

DROP POLICY IF EXISTS job_plan_aliases_insert ON public.job_plan_aliases;
CREATE POLICY job_plan_aliases_insert
  ON public.job_plan_aliases FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
    AND created_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS job_plan_aliases_update ON public.job_plan_aliases;
CREATE POLICY job_plan_aliases_update
  ON public.job_plan_aliases FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
  )
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
  );

DROP POLICY IF EXISTS job_plan_aliases_delete ON public.job_plan_aliases;
CREATE POLICY job_plan_aliases_delete
  ON public.job_plan_aliases FOR DELETE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.is_tenant_admin(tenant_id)
  );

COMMIT;
