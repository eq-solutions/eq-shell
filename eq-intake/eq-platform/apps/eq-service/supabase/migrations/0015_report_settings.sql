-- Report template settings on tenant_settings
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS report_show_cover_page boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS report_show_site_overview boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS report_show_contents boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS report_show_executive_summary boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS report_show_sign_off boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS report_header_text text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS report_footer_text text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS report_company_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS report_company_address text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS report_company_abn text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS report_company_phone text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS report_sign_off_fields jsonb NOT NULL DEFAULT '["Technician Signature","Supervisor Signature"]'::jsonb;
