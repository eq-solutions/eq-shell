-- ============================================================
-- Migration: 0003_maintenance_checks_schema
-- Sprint 7 — Maintenance Checks & Check Items
-- Applied to: urjhmkhbgaxrofurpbgc (eq-solves-service-dev)
-- ============================================================

-- 1. maintenance_checks — an instance of a job plan execution
CREATE TABLE public.maintenance_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id),
  job_plan_id uuid NOT NULL REFERENCES public.job_plans(id),
  site_id     uuid NOT NULL REFERENCES public.sites(id),
  assigned_to uuid REFERENCES auth.users(id),
  status      text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'complete', 'overdue', 'cancelled')),
  due_date    date NOT NULL,
  started_at  timestamptz,
  completed_at timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.maintenance_checks IS 'Instance of a job plan check assigned to a technician with due date and status workflow.';

-- 2. maintenance_check_items — line items copied from job_plan_items, with results
CREATE TABLE public.maintenance_check_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id),
  check_id          uuid NOT NULL REFERENCES public.maintenance_checks(id) ON DELETE CASCADE,
  job_plan_item_id  uuid REFERENCES public.job_plan_items(id),
  asset_id          uuid REFERENCES public.assets(id),
  description       text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  is_required       boolean NOT NULL DEFAULT true,
  result            text CHECK (result IN ('pass', 'fail', 'na')),
  notes             text,
  completed_at      timestamptz,
  completed_by      uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.maintenance_check_items IS 'Individual task within a maintenance check. Copied from job_plan_items at check creation. Result tracks pass/fail/na.';

-- 3. Indexes
CREATE INDEX idx_maintenance_checks_tenant ON public.maintenance_checks(tenant_id);
CREATE INDEX idx_maintenance_checks_site ON public.maintenance_checks(site_id);
CREATE INDEX idx_maintenance_checks_job_plan ON public.maintenance_checks(job_plan_id);
CREATE INDEX idx_maintenance_checks_assigned ON public.maintenance_checks(assigned_to);
CREATE INDEX idx_maintenance_checks_status ON public.maintenance_checks(status);
CREATE INDEX idx_maintenance_checks_due_date ON public.maintenance_checks(due_date);
CREATE INDEX idx_maintenance_check_items_check ON public.maintenance_check_items(check_id);
CREATE INDEX idx_maintenance_check_items_tenant ON public.maintenance_check_items(tenant_id);

-- 4. updated_at triggers
CREATE TRIGGER set_maintenance_checks_updated_at
  BEFORE UPDATE ON public.maintenance_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_maintenance_check_items_updated_at
  BEFORE UPDATE ON public.maintenance_check_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS
ALTER TABLE public.maintenance_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_check_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view checks"
  ON public.maintenance_checks FOR SELECT
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

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

CREATE POLICY "Write roles and assigned technicians can update checks"
  ON public.maintenance_checks FOR UPDATE
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_members.user_id = auth.uid()
          AND tenant_members.tenant_id = maintenance_checks.tenant_id
          AND tenant_members.is_active = true
          AND tenant_members.role IN ('super_admin', 'admin', 'supervisor')
      )
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "Admin can delete checks"
  ON public.maintenance_checks FOR DELETE
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = maintenance_checks.tenant_id
        AND tenant_members.is_active = true
        AND tenant_members.role IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Tenant members can view check items"
  ON public.maintenance_check_items FOR SELECT
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "Admin and supervisor can create check items"
  ON public.maintenance_check_items FOR INSERT
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = maintenance_check_items.tenant_id
        AND tenant_members.is_active = true
        AND tenant_members.role IN ('super_admin', 'admin', 'supervisor')
    )
  );

CREATE POLICY "Write roles and assigned technicians can update check items"
  ON public.maintenance_check_items FOR UPDATE
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_members.user_id = auth.uid()
          AND tenant_members.tenant_id = maintenance_check_items.tenant_id
          AND tenant_members.is_active = true
          AND tenant_members.role IN ('super_admin', 'admin', 'supervisor')
      )
      OR EXISTS (
        SELECT 1 FROM public.maintenance_checks mc
        WHERE mc.id = maintenance_check_items.check_id
          AND mc.assigned_to = auth.uid()
      )
    )
  );

CREATE POLICY "Admin can delete check items"
  ON public.maintenance_check_items FOR DELETE
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = maintenance_check_items.tenant_id
        AND tenant_members.is_active = true
        AND tenant_members.role IN ('super_admin', 'admin')
    )
  );
