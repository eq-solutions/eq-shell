-- Migration 0054: Policies for the orphaned `public.contacts` table
--
-- Context:
--   Supabase security advisor flagged `public.contacts` as "RLS enabled, 0 policies".
--   The table exists (schema looks like a planned unified contacts model) but has
--   zero rows, no create-time policy, and is never referenced by the app — which
--   uses `customer_contacts` and `site_contacts` instead.
--
--   Rather than drop it (which risks losing something a future migration pins to),
--   we bring it in line with the standard tenant-scoped pattern so (a) the advisor
--   stops warning, and (b) if anything ever starts writing to it, tenant isolation
--   is enforced from day one.
--
-- Policies mirror `customer_contacts` but use the (select auth.uid()) wrap per
-- AGENTS.md §"Wrap auth.uid() inside RLS expressions" — this was a known gap on
-- the older `customer_contacts` policies.
--
-- Idempotent: all CREATE POLICY statements are gated by IF NOT EXISTS checks.

do $$
begin
  -- Tenant members can read contacts in their tenant
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'contacts'
      and policyname = 'Tenant members can read contacts'
  ) then
    create policy "Tenant members can read contacts"
      on public.contacts
      for select
      using (
        tenant_id in (
          select tm.tenant_id
          from public.tenant_members tm
          where tm.user_id = (select auth.uid())
            and tm.is_active = true
        )
      );
  end if;

  -- Writers (admin / super_admin / supervisor) can insert/update/delete contacts
  -- in their tenant. Split from the read policy to avoid overlapping permissive
  -- policies for SELECT (see AGENTS.md §"Avoid overlapping permissive policies").
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'contacts'
      and policyname = 'Writers can insert contacts'
  ) then
    create policy "Writers can insert contacts"
      on public.contacts
      for insert
      with check (
        tenant_id in (
          select tm.tenant_id
          from public.tenant_members tm
          where tm.user_id = (select auth.uid())
            and tm.is_active = true
            and tm.role = any (array['super_admin','admin','supervisor'])
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'contacts'
      and policyname = 'Writers can update contacts'
  ) then
    create policy "Writers can update contacts"
      on public.contacts
      for update
      using (
        tenant_id in (
          select tm.tenant_id
          from public.tenant_members tm
          where tm.user_id = (select auth.uid())
            and tm.is_active = true
            and tm.role = any (array['super_admin','admin','supervisor'])
        )
      )
      with check (
        tenant_id in (
          select tm.tenant_id
          from public.tenant_members tm
          where tm.user_id = (select auth.uid())
            and tm.is_active = true
            and tm.role = any (array['super_admin','admin','supervisor'])
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'contacts'
      and policyname = 'Writers can delete contacts'
  ) then
    create policy "Writers can delete contacts"
      on public.contacts
      for delete
      using (
        tenant_id in (
          select tm.tenant_id
          from public.tenant_members tm
          where tm.user_id = (select auth.uid())
            and tm.is_active = true
            and tm.role = any (array['super_admin','admin','supervisor'])
        )
      );
  end if;
end$$;
