-- ============================================================
-- 0036_asset_counts_rpc.sql
--
-- PostgREST has a hard db-max-rows cap (default 1000) that
-- .range() cannot exceed. Counting active assets per site by
-- fetching the raw rows is therefore broken once a tenant has
-- more than 1000 assets. This RPC pushes the aggregation into
-- Postgres so the response only contains one row per site.
-- ============================================================

create or replace function public.get_active_asset_counts_by_site(p_site_ids uuid[])
returns table (site_id uuid, asset_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.site_id, count(*)::bigint
    from public.assets a
   where a.is_active = true
     and a.site_id = any(p_site_ids)
   group by a.site_id;
$$;

comment on function public.get_active_asset_counts_by_site(uuid[]) is
  'Returns active asset counts grouped by site for the given site IDs. Uses caller RLS so tenant scoping is preserved.';

grant execute on function public.get_active_asset_counts_by_site(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- Distinct asset types — same row-cap problem on the assets
-- listing page's filter dropdown.
-- ------------------------------------------------------------
create or replace function public.get_distinct_asset_types()
returns table (asset_type text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct a.asset_type
    from public.assets a
   where a.asset_type is not null
   order by a.asset_type;
$$;

comment on function public.get_distinct_asset_types() is
  'Returns the unique set of asset_type values, RLS-scoped. Avoids the PostgREST 1000-row cap.';

grant execute on function public.get_distinct_asset_types() to authenticated;
