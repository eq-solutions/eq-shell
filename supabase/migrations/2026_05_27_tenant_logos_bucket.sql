-- Migration: 2026_05_27_tenant_logos_bucket
-- Target:    Shared eq-canonical (control plane Supabase project)
-- Purpose:   Creates the tenant-logos storage bucket with public read access.
--
-- !! DO NOT AUTO-APPLY !!
-- This migration requires manual confirmation via the Supabase dashboard
-- or explicit CLI instruction from Royce before being applied to any live
-- database. Applying storage bucket changes is irreversible without manual
-- cleanup. Confirm the bucket does not already exist before running.
--
-- To apply manually:
--   Option A: Supabase dashboard → Storage → New bucket
--             Name: tenant-logos, Public: true, File size limit: 512 KB,
--             Allowed MIME types: image/png, image/jpeg, image/svg+xml, image/webp
--   Option B: supabase db push (after confirming with Royce)
--
-- The bucket must be public so logo URLs work without signed-URL overhead.
-- RLS: write access is restricted to authenticated users with matching
-- tenant_id in app_metadata (managers only — enforced at the application
-- layer via /.netlify/functions/shell-login role check before any upload
-- is permitted).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-logos',
  'tenant-logos',
  true,
  524288,  -- 512 KB max per logo
  array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
on conflict (id) do nothing;

-- Allow authenticated users to upload to their own tenant folder only.
create policy "Managers upload own tenant logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and auth.jwt() -> 'app_metadata' ->> 'eq_role' = 'manager'
  );

-- Public read — logos are referenced by URL in the hub and on login pages.
create policy "Public read tenant logos"
  on storage.objects for select
  to public
  using (bucket_id = 'tenant-logos');
