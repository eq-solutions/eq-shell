-- ============================================================
-- Migration 0065: Drop dead report-settings columns
--
-- Reports audit (26-Apr-2026, audit items 6-8) found three settings on
-- tenant_settings that were either dead or inconsistently consumed:
--
--   report_site_photos          → no PDF generator read it
--   report_show_site_overview   → only pm-asset-report read it (1 of 6)
--   report_customer_logo        → only the maintenance Send-Report path read it
--
-- The form, server action, types, and generator code paths were all
-- updated to bake in safe defaults (site overview + customer logo always
-- rendered, site-photos block dropped). These columns are now genuinely
-- unreferenced — drop them to shrink tenant_settings and prevent future
-- "what's this for?" confusion.
--
-- Idempotent: IF EXISTS guards on each drop.
-- ============================================================

ALTER TABLE public.tenant_settings
  DROP COLUMN IF EXISTS report_site_photos,
  DROP COLUMN IF EXISTS report_show_site_overview,
  DROP COLUMN IF EXISTS report_customer_logo;
