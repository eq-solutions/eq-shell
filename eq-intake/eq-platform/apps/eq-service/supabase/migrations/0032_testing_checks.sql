-- Testing Checks: groups multiple ACB/NSX test records under one named check
-- e.g. "SY1 Annual E1.25 April 2026"

create table if not exists public.testing_checks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  job_plan_id uuid references public.job_plans(id) on delete set null,
  name        text not null,
  check_type  text not null default 'acb' check (check_type in ('acb', 'nsx', 'general')),
  frequency   text,
  month       integer check (month between 1 and 12),
  year        integer,
  status      text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'complete', 'cancelled')),
  created_by  uuid references auth.users(id) on delete set null,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index idx_testing_checks_tenant on public.testing_checks(tenant_id);
create index idx_testing_checks_site on public.testing_checks(site_id);
create index idx_testing_checks_status on public.testing_checks(status);

-- Updated-at trigger
create trigger set_updated_at_testing_checks
  before update on public.testing_checks
  for each row execute function public.set_updated_at();

-- RLS
alter table public.testing_checks enable row level security;

create policy "Tenant members can view testing checks"
  on public.testing_checks for select
  using (tenant_id = ANY (public.get_user_tenant_ids()));

create policy "Writers can manage testing checks"
  on public.testing_checks for all
  using (tenant_id = ANY (public.get_user_tenant_ids()))
  with check (tenant_id = ANY (public.get_user_tenant_ids()));

-- Add testing_check_id FK to acb_tests
alter table public.acb_tests
  add column if not exists testing_check_id uuid references public.testing_checks(id) on delete set null;

create index if not exists idx_acb_tests_testing_check on public.acb_tests(testing_check_id);

-- Add testing_check_id FK to nsx_tests
alter table public.nsx_tests
  add column if not exists testing_check_id uuid references public.testing_checks(id) on delete set null;

create index if not exists idx_nsx_tests_testing_check on public.nsx_tests(testing_check_id);
