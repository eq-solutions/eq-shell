-- Defects table — raised from maintenance checks, tracked to resolution
create table if not exists defects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  check_id uuid references maintenance_checks(id) on delete set null,
  check_asset_id uuid references check_assets(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  title text not null,
  description text,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  raised_by uuid references auth.users(id),
  assigned_to uuid references auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_defects_tenant on defects(tenant_id);
create index idx_defects_check on defects(check_id);
create index idx_defects_asset on defects(asset_id);
create index idx_defects_status on defects(status);

alter table defects enable row level security;

create policy "Tenant isolation" on defects
  for all using (tenant_id = (select current_setting('app.tenant_id', true))::uuid);

create trigger set_updated_at before update on defects
  for each row execute function set_updated_at();
