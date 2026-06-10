-- ============================================================
-- Migration 0007: NSX Tests + NSX Test Readings
-- Specialised test entry for Moulded Case Circuit Breakers (MCCB)
-- Schneider NSX range and equivalents
-- ============================================================

-- 1. nsx_tests table
CREATE TABLE IF NOT EXISTS public.nsx_tests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  test_date       date NOT NULL,
  tested_by       uuid REFERENCES auth.users(id),
  test_type       varchar(20) NOT NULL DEFAULT 'Routine' CHECK (test_type IN ('Initial', 'Routine', 'Special')),
  cb_make         varchar(100),
  cb_model        varchar(100),
  cb_serial       varchar(100),
  cb_rating       varchar(50),
  cb_poles        varchar(10),
  trip_unit       varchar(100),
  overall_result  varchar(20) NOT NULL DEFAULT 'Pending' CHECK (overall_result IN ('Pending', 'Pass', 'Fail', 'Defect')),
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nsx_tests_tenant ON public.nsx_tests(tenant_id);
CREATE INDEX idx_nsx_tests_asset ON public.nsx_tests(asset_id);
CREATE INDEX idx_nsx_tests_site ON public.nsx_tests(site_id);
CREATE INDEX idx_nsx_tests_result ON public.nsx_tests(overall_result);
CREATE INDEX idx_nsx_tests_date ON public.nsx_tests(test_date);

CREATE TRIGGER set_nsx_tests_updated_at
  BEFORE UPDATE ON public.nsx_tests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. nsx_test_readings table
CREATE TABLE IF NOT EXISTS public.nsx_test_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nsx_test_id   uuid NOT NULL REFERENCES public.nsx_tests(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label         varchar(200) NOT NULL,
  value         varchar(200) NOT NULL,
  unit          varchar(50),
  is_pass       boolean,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nsx_readings_test ON public.nsx_test_readings(nsx_test_id);
CREATE INDEX idx_nsx_readings_tenant ON public.nsx_test_readings(tenant_id);

-- 3. RLS — nsx_tests
ALTER TABLE public.nsx_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nsx_tests_select" ON public.nsx_tests
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "nsx_tests_insert" ON public.nsx_tests
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY "nsx_tests_update" ON public.nsx_tests
  FOR UPDATE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY "nsx_tests_delete" ON public.nsx_tests
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

-- 4. RLS — nsx_test_readings
ALTER TABLE public.nsx_test_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nsx_readings_select" ON public.nsx_test_readings
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "nsx_readings_insert" ON public.nsx_test_readings
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY "nsx_readings_delete" ON public.nsx_test_readings
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );
