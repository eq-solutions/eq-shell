-- ============================================================
-- Migration 0009: Instrument Register
-- Track test instruments/equipment and calibration dates
-- ============================================================

CREATE TABLE IF NOT EXISTS public.instruments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name                varchar(200) NOT NULL,
  instrument_type     varchar(100) NOT NULL,       -- e.g. 'Multimeter', 'Insulation Tester', 'Secondary Injection'
  make                varchar(100),
  model               varchar(100),
  serial_number       varchar(100),
  asset_tag           varchar(100),                -- internal asset tag
  calibration_date    date,
  calibration_due     date,
  calibration_cert    varchar(200),                -- certificate reference
  status              varchar(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Out for Cal', 'Retired', 'Lost')),
  assigned_to         uuid REFERENCES auth.users(id),
  notes               text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_instruments_tenant ON public.instruments(tenant_id);
CREATE INDEX idx_instruments_status ON public.instruments(status);
CREATE INDEX idx_instruments_cal_due ON public.instruments(calibration_due);
CREATE INDEX idx_instruments_type ON public.instruments(instrument_type);

CREATE TRIGGER set_instruments_updated_at
  BEFORE UPDATE ON public.instruments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "instruments_select" ON public.instruments
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "instruments_insert" ON public.instruments
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY "instruments_update" ON public.instruments
  FOR UPDATE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY "instruments_delete" ON public.instruments
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );
