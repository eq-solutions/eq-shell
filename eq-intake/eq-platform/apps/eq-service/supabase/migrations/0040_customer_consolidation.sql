-- ============================================================
-- 0040_customer_consolidation.sql
--
-- Consolidate customer records to match the real-world legal
-- entities (ABN-registered names) and reassign sites to the
-- correct customer per Royce's mapping (2026-04-15).
--
-- Target mapping:
--   Equinix Australia Pty Ltd  → SY1, SY2, SY3, SY4, SY5
--   Metronode NSW Pty Ltd      → SY6, SY7
--   Equinix Hyperscale         → SY9
--   Equinix Australia National → CA1
--   Ramsay Health              → St George Private Hospital
--
-- Current state (tenant ccca00fc-...):
--   Equinix Australia (legacy catch-all)  — CA1, SY1, SY2, SY4, SY6
--   Equinix Australia Pty Ltd             — SY3, SY5, SY9
--   Metronode NSW                         — SY7
--   (no customer for St George — customer_id is null)
--
-- Actions:
--   1) Rename "Metronode NSW" → "Metronode NSW Pty Ltd"
--   2) Create "Equinix Australia National"
--   3) Create "Equinix Hyperscale"
--   4) Create "Ramsay Health"
--   5) Reassign sites per the mapping above
--   6) Soft-archive the legacy "Equinix Australia" row once empty
--
-- Hard-deletes: none. "Equinix Australia" is soft-archived so
-- any historical audit_log references remain resolvable.
-- ============================================================

-- Tenant for all real customers in this migration
-- (ccca00fc-cbc8-442e-9489-0f1f216ddca8)

-- 1) Rename Metronode NSW → Metronode NSW Pty Ltd
update public.customers
   set name = 'Metronode NSW Pty Ltd',
       updated_at = now()
 where id = 'a4cd84f1-5318-44a3-aae3-52aa388c0246'
   and name = 'Metronode NSW';

-- 2) Create Equinix Australia National (if not exists — idempotent by name + tenant)
-- Each INSERT is guarded by `AND EXISTS (SELECT 1 FROM tenants WHERE id = ...)`
-- so fresh replays (CI integration tests) where the SKS tenant doesn't exist
-- silently skip the inserts rather than hit the FK violation. Prod has the
-- tenant; the guard is a no-op there.
insert into public.customers (tenant_id, name, code, is_active)
select 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid, 'Equinix Australia National', 'EQX-NAT', true
 where not exists (
   select 1 from public.customers
    where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
      and name = 'Equinix Australia National'
 )
   and exists (
     select 1 from public.tenants
      where id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
   );

-- 3) Create Equinix Hyperscale
insert into public.customers (tenant_id, name, code, is_active)
select 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid, 'Equinix Hyperscale', 'EQX-HS', true
 where not exists (
   select 1 from public.customers
    where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
      and name = 'Equinix Hyperscale'
 )
   and exists (
     select 1 from public.tenants
      where id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
   );

-- 4) Create Ramsay Health
insert into public.customers (tenant_id, name, code, is_active)
select 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid, 'Ramsay Health', 'RHC', true
 where not exists (
   select 1 from public.customers
    where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
      and name = 'Ramsay Health'
 )
   and exists (
     select 1 from public.tenants
      where id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
   );

-- 5) Reassignments

-- CA1 → Equinix Australia National
update public.sites
   set customer_id = (
     select id from public.customers
      where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
        and name = 'Equinix Australia National'
     ),
       updated_at = now()
 where name = 'CA1'
   and is_active = true;

-- SY1, SY2, SY4 → Equinix Australia Pty Ltd
-- (SY3, SY5 already on Equinix Australia Pty Ltd)
update public.sites
   set customer_id = '50201f6b-ec76-4ad0-9b8f-c189158b9ca2'::uuid,
       updated_at = now()
 where name in ('SY1','SY2','SY4')
   and is_active = true;

-- SY6 → Metronode NSW Pty Ltd
-- (SY7 already on Metronode)
update public.sites
   set customer_id = 'a4cd84f1-5318-44a3-aae3-52aa388c0246'::uuid,
       updated_at = now()
 where name = 'SY6'
   and is_active = true;

-- SY9 → Equinix Hyperscale
update public.sites
   set customer_id = (
     select id from public.customers
      where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
        and name = 'Equinix Hyperscale'
     ),
       updated_at = now()
 where name = 'SY9'
   and is_active = true;

-- St George Private Hospital → Ramsay Health
update public.sites
   set customer_id = (
     select id from public.customers
      where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
        and name = 'Ramsay Health'
     ),
       updated_at = now()
 where name = 'St George Private Hospital'
   and is_active = true;

-- 6) Soft-archive legacy "Equinix Australia" catch-all (once empty)
update public.customers
   set is_active = false,
       deleted_at = now(),
       updated_at = now()
 where id = 'ec1c1bd8-b305-4a3d-8763-915d720c998f'::uuid
   and not exists (
     select 1 from public.sites
      where customer_id = 'ec1c1bd8-b305-4a3d-8763-915d720c998f'::uuid
        and is_active = true
   );

-- Sanity checks. Guarded by tenant-exists so fresh replays skip cleanly —
-- the counts are only meaningful when the SKS tenant has data to consolidate.
do $$
declare
  legacy_sites bigint;
  null_customer bigint;
  expected_sy_count bigint;
  expected_metronode bigint;
  expected_hs bigint;
  expected_nat bigint;
  expected_ramsay bigint;
begin
  if not exists (
    select 1 from public.tenants
     where id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
  ) then
    raise notice 'Migration 0040: SKS tenant absent (fresh DB) — skipping sanity checks';
    return;
  end if;

  -- 0 active sites should remain on the legacy Equinix Australia row
  select count(*) into legacy_sites
    from public.sites
   where customer_id = 'ec1c1bd8-b305-4a3d-8763-915d720c998f'::uuid
     and is_active = true;
  if legacy_sites > 0 then
    raise exception 'Migration 0040: % active sites still on legacy Equinix Australia', legacy_sites;
  end if;

  -- No active site in Royce's tenant may have null customer_id
  select count(*) into null_customer
    from public.sites
   where tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
     and is_active = true
     and customer_id is null;
  if null_customer > 0 then
    raise exception 'Migration 0040: % active sites have null customer_id', null_customer;
  end if;

  -- Expected counts by customer
  select count(*) into expected_sy_count
    from public.sites
   where customer_id = '50201f6b-ec76-4ad0-9b8f-c189158b9ca2'::uuid
     and is_active = true
     and name in ('SY1','SY2','SY3','SY4','SY5');
  if expected_sy_count <> 5 then
    raise exception 'Migration 0040: expected 5 sites on Equinix Australia Pty Ltd, got %', expected_sy_count;
  end if;

  select count(*) into expected_metronode
    from public.sites
   where customer_id = 'a4cd84f1-5318-44a3-aae3-52aa388c0246'::uuid
     and is_active = true
     and name in ('SY6','SY7');
  if expected_metronode <> 2 then
    raise exception 'Migration 0040: expected 2 sites on Metronode NSW Pty Ltd, got %', expected_metronode;
  end if;

  select count(*) into expected_hs
    from public.sites s
    join public.customers c on c.id = s.customer_id
   where c.name = 'Equinix Hyperscale'
     and s.is_active = true
     and s.name = 'SY9';
  if expected_hs <> 1 then
    raise exception 'Migration 0040: expected SY9 on Equinix Hyperscale, got % match', expected_hs;
  end if;

  select count(*) into expected_nat
    from public.sites s
    join public.customers c on c.id = s.customer_id
   where c.name = 'Equinix Australia National'
     and s.is_active = true
     and s.name = 'CA1';
  if expected_nat <> 1 then
    raise exception 'Migration 0040: expected CA1 on Equinix Australia National, got % match', expected_nat;
  end if;

  select count(*) into expected_ramsay
    from public.sites s
    join public.customers c on c.id = s.customer_id
   where c.name = 'Ramsay Health'
     and s.is_active = true
     and s.name = 'St George Private Hospital';
  if expected_ramsay <> 1 then
    raise exception 'Migration 0040: expected St George on Ramsay Health, got % match', expected_ramsay;
  end if;
end $$;
