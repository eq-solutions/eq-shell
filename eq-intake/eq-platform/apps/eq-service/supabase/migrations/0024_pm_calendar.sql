-- PM Calendar / Planning table
-- Stores scheduled preventative maintenance tasks across sites with cost tracking
-- Designed for future auto-email reminders (notification fields included)

CREATE TABLE IF NOT EXISTS public.pm_calendar (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,

  -- Core fields
  title text NOT NULL,
  location text,
  description text,
  category text NOT NULL DEFAULT 'Quarterly maintenance',
  start_time timestamptz NOT NULL,
  end_time timestamptz,

  -- Cost & hours tracking
  hours numeric(8,2) DEFAULT 0,
  contractor_materials_cost numeric(12,2) DEFAULT 0,

  -- Australian FY quarter (Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun)
  quarter text CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  financial_year text, -- e.g. '2025-2026'

  -- Recurrence (optional — for future scheduling engine)
  recurrence_rule text, -- iCal RRULE format, e.g. 'FREQ=MONTHLY;INTERVAL=6'
  recurrence_parent_id uuid REFERENCES public.pm_calendar(id) ON DELETE SET NULL,

  -- Future: email notification fields
  reminder_days_before integer[] DEFAULT '{}', -- e.g. {7, 1} = 7 days and 1 day before
  notification_recipients text[] DEFAULT '{}', -- email addresses
  email_template text, -- template identifier or custom body
  last_notified_at timestamptz,

  -- Metadata
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_pm_calendar_tenant ON public.pm_calendar(tenant_id);
CREATE INDEX idx_pm_calendar_site ON public.pm_calendar(site_id);
CREATE INDEX idx_pm_calendar_start ON public.pm_calendar(start_time);
CREATE INDEX idx_pm_calendar_quarter ON public.pm_calendar(quarter, financial_year);
CREATE INDEX idx_pm_calendar_category ON public.pm_calendar(category);
CREATE INDEX idx_pm_calendar_status ON public.pm_calendar(status);

-- Updated_at trigger
CREATE TRIGGER set_pm_calendar_updated_at
  BEFORE UPDATE ON public.pm_calendar
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.pm_calendar ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped read
CREATE POLICY "pm_calendar_select" ON public.pm_calendar
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

-- Supervisor+ create
CREATE POLICY "pm_calendar_insert" ON public.pm_calendar
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

-- Supervisor+ update
CREATE POLICY "pm_calendar_update" ON public.pm_calendar
  FOR UPDATE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

-- Admin delete
CREATE POLICY "pm_calendar_delete" ON public.pm_calendar
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

-- Comments
COMMENT ON TABLE public.pm_calendar IS 'PM planning calendar entries — scheduled tasks across sites with cost tracking';
COMMENT ON COLUMN public.pm_calendar.quarter IS 'Australian FY quarter: Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun';
COMMENT ON COLUMN public.pm_calendar.financial_year IS 'Australian FY e.g. 2025-2026 (Jul 2025 - Jun 2026)';
COMMENT ON COLUMN public.pm_calendar.recurrence_rule IS 'iCal RRULE for future recurrence engine';
COMMENT ON COLUMN public.pm_calendar.reminder_days_before IS 'Array of days before start_time to send email reminders';
COMMENT ON COLUMN public.pm_calendar.notification_recipients IS 'Email addresses to notify for this entry';
