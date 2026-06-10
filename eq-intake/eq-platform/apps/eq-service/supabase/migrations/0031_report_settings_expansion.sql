-- Add expanded report settings: logo, customer logo toggle, site photos, report complexity
-- These columns support Item 15 — enhanced report configuration

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS report_logo_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS report_customer_logo boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS report_site_photos boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_complexity text DEFAULT 'standard'
    CHECK (report_complexity IN ('summary', 'standard', 'detailed'));
