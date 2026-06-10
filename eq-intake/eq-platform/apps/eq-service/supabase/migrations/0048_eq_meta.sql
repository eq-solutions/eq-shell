-- EQ Solves Service
-- © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
-- ACN 651 962 935 · ABN 40 651 962 935
-- Proprietary and confidential. All rights reserved.
--
-- Migration 0048: _meta table — product ownership marker
--
-- Context: IP-hardening amendment (18 Apr 2026, EQ-IP-Register item #10).
-- Every Supabase project in the EQ Solves Service family must carry an
-- explicit ownership record inside the database itself, so that
-- provenance is self-evident in any data export, migration audit, or
-- legal-discovery context. The owner of the product is CDC Solutions
-- Pty Ltd, trading under the registered business name EQ.
--
-- What this migration does:
--   1. Creates a singleton `public._meta` table (PK enforces one row).
--   2. Inserts the canonical ownership row for this project.
--   3. Enables RLS — authenticated users can SELECT, no one can write.
--   4. Grants SELECT to the `anon` and `authenticated` roles so the
--      marker is visible (but not mutable) via the client.
--
-- Idempotent: safe to re-run. All DDL uses IF NOT EXISTS and the insert
-- uses ON CONFLICT DO NOTHING so a second run is a no-op.
--
-- Apply notes (not automated):
--   - Target project (dev): urjhmkhbgaxrofurpbgc (eq-solves-service-dev)
--   - Target project (prod): TBD — apply again when the Service prod
--     project is created and update the `tenant` column if appropriate.
--   - Never apply to nspbmirochztcjijmcrx (SKS labour live).
--   - Never apply to ktmjmdzqrogauaevbktn (EQ Field demo).

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public._meta (
  -- Singleton enforcement: only one row, always id=1.
  id              smallint primary key default 1,
  product_owner   text     not null,
  trading_as      text     not null,
  product_name    text     not null,
  tenant          text     null,
  legal_acn       text     not null,
  legal_abn       text     not null,
  notes           text     null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint _meta_singleton check (id = 1)
);

comment on table  public._meta                is 'Product ownership marker — EQ Solves Service. Singleton row.';
comment on column public._meta.product_owner  is 'Legal entity that owns the product (CDC Solutions Pty Ltd).';
comment on column public._meta.trading_as     is 'Registered business name the product is sold under (EQ).';
comment on column public._meta.product_name   is 'Product identifier (EQ Solves Service).';
comment on column public._meta.tenant         is 'Tenant slug for the environment this project serves, if any.';
comment on column public._meta.legal_acn      is 'Australian Company Number of the product owner.';
comment on column public._meta.legal_abn      is 'Australian Business Number of the product owner.';

-- Auto-maintain updated_at — re-uses the global trigger function if it
-- already exists (it's defined in migration 0002 / 0003).
drop trigger if exists trg_meta_updated_at on public._meta;
create trigger trg_meta_updated_at
  before update on public._meta
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Seed the canonical ownership row
-- ---------------------------------------------------------------------------
insert into public._meta (
  id, product_owner, trading_as, product_name, tenant, legal_acn, legal_abn, notes
) values (
  1,
  'CDC Solutions Pty Ltd',
  'EQ',
  'EQ Solves Service',
  'sks-technologies',
  '651 962 935',
  '40 651 962 935',
  'Ownership marker per EQ-IP-Register item #10. Do not modify without reference to the register.'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS — readable to authenticated sessions, never writable from the client
-- ---------------------------------------------------------------------------
alter table public._meta enable row level security;

drop policy if exists "_meta is readable by anyone authenticated"   on public._meta;
drop policy if exists "_meta is readable by anon for attribution"   on public._meta;

-- Authenticated users (any tenant) can read the ownership record.
create policy "_meta is readable by anyone authenticated"
  on public._meta
  for select
  to authenticated
  using (true);

-- The ownership marker is not a secret — expose to anon so attribution
-- is visible even on public/unauthenticated surfaces (e.g. a future
-- eq.solutions status page that reads this project).
create policy "_meta is readable by anon for attribution"
  on public._meta
  for select
  to anon
  using (true);

-- Explicit: no INSERT/UPDATE/DELETE policy means no client role can
-- write. Changes go through migrations only, executed with the
-- service-role bypass.

grant select on public._meta to anon, authenticated;
