-- Migration 0047: Dark-surface logo variants + contacts consolidation
--
-- Context: Reports render a dark cover page and a light body. A single logo can't
-- look good on both surfaces — brand marks need contrast-matched variants.
--
-- This migration:
--   1. Adds `logo_url_on_dark` alongside `logo_url` on tenants, customers, sites
--      and `report_logo_url_on_dark` on tenant_settings.
--   2. Adds `sites.logo_url` (sites never had a logo field before).
--   3. Tags media_library rows with a `surface` column so the picker can filter
--      light-safe vs dark-safe variants.
--   4. Adds a `primary_contact_id` pointer on customers + sites — denormalised
--      fast-path to the primary contact (authoritative source remains
--      customer_contacts.is_primary / site_contacts.is_primary).
--
-- No data migration is performed — existing rows keep their single `logo_url`;
-- the resolver falls back to it when the _on_dark variant is missing.
--
-- This migration is idempotent: every ADD COLUMN / ADD CONSTRAINT uses IF NOT EXISTS.
-- Safe to re-run if the SQL was already applied manually to prod.

-- ---------------------------------------------------------------------------
-- 1. Dark-surface logo variants
-- ---------------------------------------------------------------------------
-- Note: the tenant-level logo lives on tenant_settings.logo_url (not on the
-- tenants table). So we add logo_url_on_dark to tenant_settings alongside it,
-- rather than creating a matched pair on tenants.

alter table public.tenant_settings
  add column if not exists logo_url_on_dark        text default null,
  add column if not exists report_logo_url_on_dark text default null;

alter table public.customers
  add column if not exists logo_url_on_dark text default null;

alter table public.sites
  add column if not exists logo_url         text default null,
  add column if not exists logo_url_on_dark text default null;

comment on column public.tenant_settings.logo_url_on_dark is
  'Tenant logo variant to render on dark surfaces (report covers, dark header bands). Falls back to logo_url when null.';
comment on column public.tenant_settings.report_logo_url_on_dark is
  'Report-specific logo override for dark surfaces. Falls back to report_logo_url, then tenant logo_url_on_dark, then logo_url.';
comment on column public.customers.logo_url_on_dark is
  'Customer logo variant for dark surfaces. Falls back to logo_url when null.';
comment on column public.sites.logo_url is
  'Site-level logo override. Falls back to customer logo when null.';
comment on column public.sites.logo_url_on_dark is
  'Site logo variant for dark surfaces. Falls back to sites.logo_url, then customer chain.';

-- ---------------------------------------------------------------------------
-- 2. media_library surface tagging
-- ---------------------------------------------------------------------------
-- When a user uploads a logo, they can tag which surface it's designed for.
-- The picker filters by surface so light-only marks don't show up for dark
-- slots (and vice versa). `any` = usable on either surface.

alter table public.media_library
  add column if not exists surface text not null default 'any';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_library_surface_check'
  ) then
    alter table public.media_library
      add constraint media_library_surface_check
      check (surface in ('light', 'dark', 'any'));
  end if;
end$$;

create index if not exists idx_media_library_surface
  on public.media_library (tenant_id, category, surface);

comment on column public.media_library.surface is
  'Which surface this asset is designed for: light (renders well on light bg), dark (renders well on dark bg), any (surface-agnostic).';

-- ---------------------------------------------------------------------------
-- 3. Primary contact fast-path
-- ---------------------------------------------------------------------------
-- Denormalised pointer so the master contacts list + report cover can read a
-- single primary contact without scanning customer_contacts / site_contacts.
-- The unique partial index on is_primary in those tables remains the
-- authoritative source — this pointer is maintained by the app/trigger.

alter table public.customers
  add column if not exists primary_contact_id uuid
    references public.customer_contacts(id) on delete set null;

alter table public.sites
  add column if not exists primary_contact_id uuid
    references public.site_contacts(id) on delete set null;

create index if not exists idx_customers_primary_contact
  on public.customers (primary_contact_id)
  where primary_contact_id is not null;

create index if not exists idx_sites_primary_contact
  on public.sites (primary_contact_id)
  where primary_contact_id is not null;

comment on column public.customers.primary_contact_id is
  'Fast-path pointer to the primary customer contact. Authoritative source is customer_contacts.is_primary.';
comment on column public.sites.primary_contact_id is
  'Fast-path pointer to the primary site contact. Authoritative source is site_contacts.is_primary.';

-- ---------------------------------------------------------------------------
-- 4. Backfill primary_contact_id from existing is_primary rows
-- ---------------------------------------------------------------------------
-- Safe to run multiple times — only updates rows where the pointer is still null
-- and a primary contact actually exists.

update public.customers c
set primary_contact_id = cc.id
from public.customer_contacts cc
where cc.customer_id = c.id
  and cc.is_primary = true
  and c.primary_contact_id is null;

update public.sites s
set primary_contact_id = sc.id
from public.site_contacts sc
where sc.site_id = s.id
  and sc.is_primary = true
  and s.primary_contact_id is null;
