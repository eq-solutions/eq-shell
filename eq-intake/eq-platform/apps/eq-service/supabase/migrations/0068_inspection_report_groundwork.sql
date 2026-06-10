-- Migration 0068: Inspection-report groundwork.
--
-- Additive columns to support generating the SafetyCulture-style
-- inspection PDFs Jemena receives today (DB Inspection, MSB Inspection,
-- Generator Run-Start, Lighting Audit). All nullable, no breaking changes.
--
-- Source: 2026-04-27 study of 6 representative Jemena 2025 reports
-- (Cardiff DB-1, Cardiff MSB, Bathurst Thermal, Greystanes Generator,
-- Old Guildford Lighting Audit, Cardiff RCD xlsx). See chat for the data
-- points captured per report type.
--
-- Scope:
-- 1. maintenance_checks.signature_technician_url — URL to tech's signature
--    image (or stored JSON if vector); goes onto the "Approved by SKS
--    Technician" footer of inspection PDFs.
-- 2. maintenance_checks.signature_site_url — URL to site representative's
--    signature; some report types include it (RCD xlsx footer).
-- 3. maintenance_checks.signature_initials — short text initials for
--    inline tabular sign-off (the per-row "AH" column on the RCD xlsx).
-- 4. maintenance_checks.gps_lat / gps_lng — coordinates captured by the
--    technician's device when starting the visit. Already shown on the
--    Cardiff DB-1 PDF cover (-32.94, 151.64).
-- 5. assets.building — multi-building site support without a new table.
--    Old Guildford + Unanderra both have multi-building hierarchy
--    (Warehouse / Office / Plant room) per the Lighting Audit report.

ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS signature_technician_url text,
  ADD COLUMN IF NOT EXISTS signature_site_url text,
  ADD COLUMN IF NOT EXISTS signature_initials text,
  ADD COLUMN IF NOT EXISTS gps_lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng numeric(9,6);

COMMENT ON COLUMN public.maintenance_checks.signature_technician_url IS
  'URL (Supabase Storage) for the technician sign-off image. Rendered on inspection report PDF footer.';
COMMENT ON COLUMN public.maintenance_checks.signature_site_url IS
  'URL (Supabase Storage) for the site representative sign-off image. Optional; used on RCD xlsx footer and some inspection reports.';
COMMENT ON COLUMN public.maintenance_checks.signature_initials IS
  'Short technician initials (e.g. "AH"). Rendered inline on tabular reports (RCD xlsx per-row).';
COMMENT ON COLUMN public.maintenance_checks.gps_lat IS
  'Latitude captured by technician device at visit start. Decimal degrees.';
COMMENT ON COLUMN public.maintenance_checks.gps_lng IS
  'Longitude captured by technician device at visit start. Decimal degrees.';

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS building text;

COMMENT ON COLUMN public.assets.building IS
  'Building name within a multi-building site (e.g. "Warehouse", "Office", "Plant room"). Optional; null for single-building sites. Used by the Lighting Audit report and to disambiguate boards on multi-building sites like Old Guildford and Unanderra.';
