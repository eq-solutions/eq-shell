-- Migration 0033: Centralized media library
-- Single source of truth for all images (customer logos, site photos, report images).
-- Referenced via dropdown pickers — no duplicates across the app.

create table if not exists public.media_library (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  category    text not null default 'general'
              check (category in ('customer_logo', 'site_photo', 'report_image', 'general')),
  entity_type text check (entity_type is null or entity_type in ('customer', 'site')),
  entity_id   uuid,
  file_url    text not null,
  file_name   text not null,
  content_type text,
  file_size   integer,
  uploaded_by uuid references auth.users(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index idx_media_library_tenant on public.media_library(tenant_id);
create index idx_media_library_entity on public.media_library(entity_type, entity_id);
create index idx_media_library_category on public.media_library(tenant_id, category);

-- Updated-at trigger
create trigger set_media_library_updated_at
  before update on public.media_library
  for each row execute function public.set_updated_at();

-- RLS
alter table public.media_library enable row level security;

-- Tenant members can view media (wrapped select for planner optimisation)
create policy "Tenant members can view media"
  on public.media_library for select
  using (tenant_id = ANY (public.get_user_tenant_ids()));

-- Writers can insert media
create policy "Writers can insert media"
  on public.media_library for insert
  with check (
    tenant_id = ANY (public.get_user_tenant_ids())
    and public.get_user_role(tenant_id) in ('super_admin', 'admin', 'supervisor')
  );

-- Writers can update media
create policy "Writers can update media"
  on public.media_library for update
  using (
    tenant_id = ANY (public.get_user_tenant_ids())
    and public.get_user_role(tenant_id) in ('super_admin', 'admin', 'supervisor')
  );

-- Admins can delete media
create policy "Admins can delete media"
  on public.media_library for delete
  using (
    tenant_id = ANY (public.get_user_tenant_ids())
    and public.get_user_role(tenant_id) in ('super_admin', 'admin')
  );
