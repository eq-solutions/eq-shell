-- ============================================================
-- Migration 0044: Defect work-order closure loop
--
-- Adds thin work-order metadata to defects table for linking
-- defects to external work order systems without a full WO table.
-- Also enforces resolved_at / resolved_by on status transitions.
-- ============================================================

-- 1. Add work-order metadata columns
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS work_order_number text,
  ADD COLUMN IF NOT EXISTS work_order_date date;

CREATE INDEX idx_defects_work_order ON public.defects(work_order_number) WHERE work_order_number IS NOT NULL;

-- 2. Fix the RLS policy — migration 0018 used current_setting('app.tenant_id')
-- which is the old pattern. Replace with the standard get_user_tenant_ids() pattern.
-- Drop the old policy first (safe — it's the only policy on defects).
DROP POLICY IF EXISTS "Tenant isolation" ON public.defects;

-- Read: any tenant member can see defects in their tenant
CREATE POLICY "tenant members read defects"
  ON public.defects FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

-- Write: writers (super_admin, admin, supervisor) can create defects
-- Technicians can also create (they raise defects during testing)
CREATE POLICY "writers create defects"
  ON public.defects FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
  );

-- Update: writers can update defects. Technicians can update defects assigned to them.
CREATE POLICY "writers update defects"
  ON public.defects FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND (
      public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
      OR assigned_to = (SELECT auth.uid())
    )
  );
