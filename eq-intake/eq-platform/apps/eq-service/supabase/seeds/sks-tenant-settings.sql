-- ============================================================================
--  Seed: SKS Technologies tenant_settings
--  Tenant ID: ccca00fc-cbc8-442e-9489-0f1f216ddca8
-- ----------------------------------------------------------------------------
--  What this script does:
--   1. Upserts tenant_settings row for the SKS tenant with reporting contact
--      details (company name, ABN, phone, address).
--   2. Optional: seeds two media_library rows for the SKS logos (blue + white)
--      so they can be picked from the MediaPicker on the settings, report,
--      customer and site forms.
--
--  How to run:
--   - Open Supabase SQL editor on project urjhmkhbgaxrofurpbgc.
--   - Paste this file, fill the TODO placeholders with real values, then run.
--   - Safe to re-run — idempotent on (tenant_id) where applicable.
--
--  Do NOT commit real contact details if they were not already public.
--  Leave the placeholders in source; keep the filled version in 1Password.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tenant_settings
-- ---------------------------------------------------------------------------
-- The row should already exist from onboarding. If not, INSERT … ON CONFLICT
-- handles both cases.

insert into public.tenant_settings (
  tenant_id,
  product_name,
  primary_colour,
  report_company_name,
  report_company_abn,
  report_company_phone,
  report_company_address,
  report_complexity
)
values (
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'SKS Technologies',
  '#3DA8D8',
  'SKS Technologies Pty Ltd',
  'TODO: fill ABN',              -- e.g. 'ABN 12 345 678 910'
  'TODO: fill phone',            -- e.g. '+61 3 9xxx xxxx'
  'TODO: fill street address',   -- e.g. '123 Somewhere St, City VIC 3xxx'
  'standard'
)
on conflict (tenant_id) do update set
  product_name           = excluded.product_name,
  report_company_name    = excluded.report_company_name,
  report_company_abn     = coalesce(nullif(excluded.report_company_abn, 'TODO: fill ABN'),              public.tenant_settings.report_company_abn),
  report_company_phone   = coalesce(nullif(excluded.report_company_phone, 'TODO: fill phone'),          public.tenant_settings.report_company_phone),
  report_company_address = coalesce(nullif(excluded.report_company_address, 'TODO: fill street address'), public.tenant_settings.report_company_address),
  updated_at             = now();

-- ---------------------------------------------------------------------------
-- 2. media_library — SKS logos (TODO: upload real SKS artwork first)
-- ---------------------------------------------------------------------------
-- Before uploading new SKS artwork:
--   1. Upload blue-on-light and white-on-dark logo SVGs to the `logos` bucket
--      in Supabase Storage (or via Admin → Media Library UI).
--   2. Copy the public file URLs here and uncomment the inserts below.
--
-- Tagging the `surface` column (added in migration 0047) lets the MediaPicker
-- filter light-safe assets out of the dark-surface picker and vice versa.

/*
insert into public.media_library (
  tenant_id, name, file_url, category, surface, is_active, content_type
)
values
  (
    'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
    'SKS logo — blue (light surface)',
    'TODO: fill uploaded URL',
    'logo',
    'light',
    true,
    'image/svg+xml'
  ),
  (
    'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
    'SKS logo — white (dark surface)',
    'TODO: fill uploaded URL',
    'logo',
    'dark',
    true,
    'image/svg+xml'
  )
on conflict do nothing;
*/

-- ---------------------------------------------------------------------------
-- 3. Supervisor contact (optional)
-- ---------------------------------------------------------------------------
-- The PM Asset Report cover page reads a `supervisorName` from the maintenance
-- check's completed_by profile — no tenant-level field for it. If you want
-- a tenant-wide default supervisor, either ensure checks are assigned to
-- that user, or extend `tenant_settings` with a `default_supervisor_id`
-- column in a new migration. Not added here.

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- After running, verify:
select
  product_name,
  report_company_name,
  report_company_abn,
  report_company_phone,
  report_company_address,
  logo_url,
  logo_url_on_dark,
  report_logo_url,
  report_logo_url_on_dark
from public.tenant_settings
where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8';
