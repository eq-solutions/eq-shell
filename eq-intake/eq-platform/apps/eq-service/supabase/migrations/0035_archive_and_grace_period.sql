-- ============================================================
-- 0035_archive_and_grace_period.sql
--
-- Unified archive / recycle-bin with auto-purge.
--
-- Six entity types can be soft-deleted (is_active = false) and then
-- reviewed at /admin/archive. Each deactivation stamps deleted_at so
-- a daily pg_cron job can hard-delete anything past the tenant's
-- grace period (30/60/90 days), dependency-safe.
--
-- Existing inactive rows are left with deleted_at = NULL so they
-- will NEVER be auto-purged — Royce reviews and removes those by
-- hand. Only rows deactivated after this migration get a countdown.
-- ============================================================

-- ------------------------------------------------------------
-- 1. pg_cron extension (safe if already enabled)
-- ------------------------------------------------------------
create extension if not exists pg_cron;

-- ------------------------------------------------------------
-- 2. deleted_at columns on the six archivable tables
-- ------------------------------------------------------------
alter table public.customers          add column if not exists deleted_at timestamptz;
alter table public.sites              add column if not exists deleted_at timestamptz;
alter table public.assets             add column if not exists deleted_at timestamptz;
alter table public.job_plans          add column if not exists deleted_at timestamptz;
alter table public.maintenance_checks add column if not exists deleted_at timestamptz;
alter table public.testing_checks     add column if not exists deleted_at timestamptz;

comment on column public.customers.deleted_at          is 'Set when is_active flips true->false. Anchor for auto-purge countdown. NULL = never auto-purge.';
comment on column public.sites.deleted_at              is 'Set when is_active flips true->false. Anchor for auto-purge countdown. NULL = never auto-purge.';
comment on column public.assets.deleted_at             is 'Set when is_active flips true->false. Anchor for auto-purge countdown. NULL = never auto-purge.';
comment on column public.job_plans.deleted_at          is 'Set when is_active flips true->false. Anchor for auto-purge countdown. NULL = never auto-purge.';
comment on column public.maintenance_checks.deleted_at is 'Set when is_active flips true->false. Anchor for auto-purge countdown. NULL = never auto-purge.';
comment on column public.testing_checks.deleted_at     is 'Set when is_active flips true->false. Anchor for auto-purge countdown. NULL = never auto-purge.';

-- Partial index for fast purge scans
create index if not exists idx_customers_deleted_at          on public.customers(deleted_at)          where deleted_at is not null;
create index if not exists idx_sites_deleted_at              on public.sites(deleted_at)              where deleted_at is not null;
create index if not exists idx_assets_deleted_at             on public.assets(deleted_at)             where deleted_at is not null;
create index if not exists idx_job_plans_deleted_at          on public.job_plans(deleted_at)          where deleted_at is not null;
create index if not exists idx_maintenance_checks_deleted_at on public.maintenance_checks(deleted_at) where deleted_at is not null;
create index if not exists idx_testing_checks_deleted_at     on public.testing_checks(deleted_at)     where deleted_at is not null;

-- ------------------------------------------------------------
-- 3. Grace-period setting on tenant_settings
-- ------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists archive_grace_period_days integer not null default 30
    check (archive_grace_period_days in (30, 60, 90));

comment on column public.tenant_settings.archive_grace_period_days is 'Days between soft-delete and auto-purge. 30/60/90 only.';

-- ------------------------------------------------------------
-- 4. Trigger: stamp deleted_at on is_active transitions
-- ------------------------------------------------------------
create or replace function public.set_deleted_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only act when is_active actually changes
  if (old.is_active is distinct from new.is_active) then
    if new.is_active = false then
      -- Archiving — stamp deleted_at if it wasn't already set
      new.deleted_at := coalesce(new.deleted_at, now());
    else
      -- Restoring — clear the countdown
      new.deleted_at := null;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.set_deleted_at() is 'Stamps deleted_at on soft-delete, clears it on restore.';

-- Attach to all six tables
drop trigger if exists set_deleted_at_customers          on public.customers;
drop trigger if exists set_deleted_at_sites              on public.sites;
drop trigger if exists set_deleted_at_assets             on public.assets;
drop trigger if exists set_deleted_at_job_plans          on public.job_plans;
drop trigger if exists set_deleted_at_maintenance_checks on public.maintenance_checks;
drop trigger if exists set_deleted_at_testing_checks     on public.testing_checks;

create trigger set_deleted_at_customers          before update on public.customers          for each row execute function public.set_deleted_at();
create trigger set_deleted_at_sites              before update on public.sites              for each row execute function public.set_deleted_at();
create trigger set_deleted_at_assets             before update on public.assets             for each row execute function public.set_deleted_at();
create trigger set_deleted_at_job_plans          before update on public.job_plans          for each row execute function public.set_deleted_at();
create trigger set_deleted_at_maintenance_checks before update on public.maintenance_checks for each row execute function public.set_deleted_at();
create trigger set_deleted_at_testing_checks     before update on public.testing_checks     for each row execute function public.set_deleted_at();

-- ------------------------------------------------------------
-- 5. Purge function — dependency-safe hard delete
--
-- Runs as SECURITY DEFINER so pg_cron (no user session) can still
-- bypass RLS. Iterates eligible rows per entity type in a safe
-- order (children before parents). Any row whose hard delete fails
-- due to a foreign-key violation is silently skipped — it will be
-- retried on the next run once its children are past grace.
-- ------------------------------------------------------------
create or replace function public.purge_expired_archives()
returns table (
  entity_type text,
  deleted_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec               record;
  v_deleted         integer;
  v_skipped         integer;
  v_tenant_grace_ms interval;
begin
  -- ------- assets (leaf under sites/job_plans) -------
  v_deleted := 0;
  v_skipped := 0;
  for rec in
    select a.id, a.tenant_id
      from public.assets a
      join public.tenant_settings ts on ts.tenant_id = a.tenant_id
     where a.is_active = false
       and a.deleted_at is not null
       and a.deleted_at < now() - make_interval(days => ts.archive_grace_period_days)
  loop
    begin
      delete from public.assets where id = rec.id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  entity_type := 'assets'; deleted_count := v_deleted; skipped_count := v_skipped;
  return next;

  -- ------- testing_checks -------
  v_deleted := 0; v_skipped := 0;
  for rec in
    select tc.id, tc.tenant_id
      from public.testing_checks tc
      join public.tenant_settings ts on ts.tenant_id = tc.tenant_id
     where tc.is_active = false
       and tc.deleted_at is not null
       and tc.deleted_at < now() - make_interval(days => ts.archive_grace_period_days)
  loop
    begin
      delete from public.testing_checks where id = rec.id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  entity_type := 'testing_checks'; deleted_count := v_deleted; skipped_count := v_skipped;
  return next;

  -- ------- maintenance_checks -------
  v_deleted := 0; v_skipped := 0;
  for rec in
    select mc.id, mc.tenant_id
      from public.maintenance_checks mc
      join public.tenant_settings ts on ts.tenant_id = mc.tenant_id
     where mc.is_active = false
       and mc.deleted_at is not null
       and mc.deleted_at < now() - make_interval(days => ts.archive_grace_period_days)
  loop
    begin
      delete from public.maintenance_checks where id = rec.id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  entity_type := 'maintenance_checks'; deleted_count := v_deleted; skipped_count := v_skipped;
  return next;

  -- ------- job_plans -------
  v_deleted := 0; v_skipped := 0;
  for rec in
    select jp.id, jp.tenant_id
      from public.job_plans jp
      join public.tenant_settings ts on ts.tenant_id = jp.tenant_id
     where jp.is_active = false
       and jp.deleted_at is not null
       and jp.deleted_at < now() - make_interval(days => ts.archive_grace_period_days)
  loop
    begin
      delete from public.job_plans where id = rec.id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  entity_type := 'job_plans'; deleted_count := v_deleted; skipped_count := v_skipped;
  return next;

  -- ------- sites -------
  v_deleted := 0; v_skipped := 0;
  for rec in
    select s.id, s.tenant_id
      from public.sites s
      join public.tenant_settings ts on ts.tenant_id = s.tenant_id
     where s.is_active = false
       and s.deleted_at is not null
       and s.deleted_at < now() - make_interval(days => ts.archive_grace_period_days)
  loop
    begin
      delete from public.sites where id = rec.id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  entity_type := 'sites'; deleted_count := v_deleted; skipped_count := v_skipped;
  return next;

  -- ------- customers -------
  v_deleted := 0; v_skipped := 0;
  for rec in
    select c.id, c.tenant_id
      from public.customers c
      join public.tenant_settings ts on ts.tenant_id = c.tenant_id
     where c.is_active = false
       and c.deleted_at is not null
       and c.deleted_at < now() - make_interval(days => ts.archive_grace_period_days)
  loop
    begin
      delete from public.customers where id = rec.id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  entity_type := 'customers'; deleted_count := v_deleted; skipped_count := v_skipped;
  return next;

  return;
end;
$$;

comment on function public.purge_expired_archives() is
  'Hard-deletes soft-deleted rows past their tenant grace period. Children first, parents last. Skips rows with FK dependents; they retry next run.';

-- ------------------------------------------------------------
-- 6. Daily cron job — 16:00 UTC == 02:00 AEST
-- ------------------------------------------------------------
-- Remove any prior schedule with this name (idempotent re-run)
select cron.unschedule('purge_expired_archives_daily')
  where exists (
    select 1 from cron.job where jobname = 'purge_expired_archives_daily'
  );

select cron.schedule(
  'purge_expired_archives_daily',
  '0 16 * * *',
  $cron$ select public.purge_expired_archives(); $cron$
);
