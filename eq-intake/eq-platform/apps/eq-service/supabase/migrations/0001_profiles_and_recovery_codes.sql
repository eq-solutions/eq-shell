-- Migration: 0001_profiles_and_recovery_codes
-- Purpose: create profiles table (role-based access), mfa_recovery_codes table, RLS policies, and auto-create trigger.
-- Rollback: drop table public.mfa_recovery_codes cascade; drop table public.profiles cascade;
--           drop function public.handle_new_user() cascade; drop function public.set_updated_at() cascade;
--           drop function public.is_admin() cascade;

-- =============================================================================
-- profiles table
-- =============================================================================
create table public.profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  email         text        not null,
  full_name     text,
  role          text        not null default 'user' check (role in ('admin', 'user')),
  is_active     boolean     not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (email);
create index profiles_role_idx  on public.profiles (role);

comment on table  public.profiles is 'User profile linked to auth.users. Holds role, active state, and audit fields.';
comment on column public.profiles.role is 'admin | user. Controls access to /admin/* routes.';
comment on column public.profiles.is_active is 'Soft-deactivation flag. Inactive users cannot access the app.';

-- =============================================================================
-- mfa_recovery_codes table
-- =============================================================================
create table public.mfa_recovery_codes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  code_hash  text        not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id) where used_at is null;

comment on table  public.mfa_recovery_codes is 'One-time recovery codes issued at MFA enrolment. Bcrypt-hashed, single-use.';
comment on column public.mfa_recovery_codes.used_at is 'Set when the code is consumed. Null = still valid.';

-- =============================================================================
-- updated_at trigger (generic)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- auto-create profile on auth.users insert
-- Seeds admin role for bootstrap admin emails.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := 'user';
  v_admin_emails text[] := array['dev@eq.solutions'];
begin
  if new.email = any(v_admin_emails) then
    v_role := 'admin';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    v_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- =============================================================================
-- is_admin() helper — used by RLS policies on other tables later
-- =============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

-- =============================================================================
-- RLS policies
-- =============================================================================
alter table public.profiles            enable row level security;
alter table public.mfa_recovery_codes  enable row level security;

-- profiles: users read own row; admins read/update all rows
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy profiles_select_admin
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
  -- users cannot change their own role

create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- mfa_recovery_codes: users only see their own unused codes (for verification).
-- Writes happen via service_role only (server-side enrolment).
create policy mfa_recovery_codes_select_own
  on public.mfa_recovery_codes
  for select
  to authenticated
  using (user_id = auth.uid());
