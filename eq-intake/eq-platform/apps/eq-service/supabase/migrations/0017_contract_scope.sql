-- Contract scope reference — lightweight table for management to define
-- what work is included/excluded per customer per financial year.

create table if not exists contract_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  financial_year text not null default '2025-2026',
  scope_item text not null,
  is_included boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for common queries
create index idx_contract_scopes_tenant on contract_scopes(tenant_id);
create index idx_contract_scopes_customer on contract_scopes(customer_id);
create index idx_contract_scopes_fy on contract_scopes(financial_year);

-- RLS
alter table contract_scopes enable row level security;

create policy "Tenant isolation" on contract_scopes
  for all using (tenant_id = (select current_setting('app.tenant_id', true))::uuid);

-- Updated at trigger
create trigger set_updated_at before update on contract_scopes
  for each row execute function set_updated_at();
