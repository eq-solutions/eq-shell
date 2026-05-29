-- Migration: 2026_05_29_asset_certs_bucket
-- Target:    Shared eq-canonical (control plane Supabase project)
-- Purpose:   Creates the asset-certs storage bucket for plant & equipment
--            calibration certificates, uploaded via
--            /.netlify/functions/upload-asset-cert and referenced by URL in
--            app_data.assets.cert_url.
--
-- !! ALREADY APPLIED to eq-canonical (jvknxcmbtrfnxfrwfimn) on 2026-05-29 via
--    the Supabase MCP. This file is the version-controlled record. DO NOT
--    AUTO-APPLY elsewhere without confirming with Royce — bucket changes are
--    irreversible without manual cleanup.
--
-- Public-read by design: these are calibration certs for meters/tools, not
-- confidential, so the URL opens directly (no signed-URL overhead) — matching
-- the tenant-logos pattern. Paths are tenant-scoped + uuid-prefixed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-certs',
  'asset-certs',
  true,
  10485760,  -- 10 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Insert restricted to authenticated managers/supervisors writing into their
-- own tenant folder. Defence in depth — the actual upload runs through the
-- service-role function (which bypasses RLS) after its own role check.
create policy "Equipment editors upload own tenant cert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'asset-certs'
    and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (auth.jwt() -> 'app_metadata' ->> 'eq_role') in ('manager', 'supervisor')
  );

-- Public read — cert URLs open directly from the equipment list.
create policy "Public read asset certs"
  on storage.objects for select
  to public
  using (bucket_id = 'asset-certs');
