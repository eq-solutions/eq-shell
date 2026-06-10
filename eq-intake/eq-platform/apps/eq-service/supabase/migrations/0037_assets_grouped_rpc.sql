-- ============================================================
-- 0037_assets_grouped_rpc.sql
--
-- The Assets page's grouped view needs every matching asset to
-- build its Site > Location > Job Plan tree. Fetching raw rows
-- via PostgREST is capped at db-max-rows (1000) regardless of
-- .range() / .limit(), so tenants with >1000 assets see a
-- truncated tree (4764 -> exactly 1000 silently).
--
-- Returning a scalar jsonb from an RPC sidesteps the cap: the
-- response is a single value, not a row set. Client parses the
-- array and builds the tree in memory.
-- ============================================================

create or replace function public.get_assets_for_grouping(
  p_show_archived boolean default false,
  p_search text default null,
  p_site_id uuid default null,
  p_asset_type text default null,
  p_job_plan_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'tenant_id', a.tenant_id,
        'site_id', a.site_id,
        'job_plan_id', a.job_plan_id,
        'name', a.name,
        'asset_type', a.asset_type,
        'serial_number', a.serial_number,
        'maximo_id', a.maximo_id,
        'location', a.location,
        'is_active', a.is_active,
        'created_at', a.created_at,
        'updated_at', a.updated_at,
        'sites', case when s.id is not null
                      then jsonb_build_object('name', s.name)
                      else null end,
        'job_plans', case when jp.id is not null
                          then jsonb_build_object('name', jp.name, 'code', jp.code)
                          else null end
      )
      order by a.name
    ),
    '[]'::jsonb
  )
    from public.assets a
    left join public.sites s on s.id = a.site_id
    left join public.job_plans jp on jp.id = a.job_plan_id
   where (p_show_archived or a.is_active = true)
     and (p_site_id is null or a.site_id = p_site_id)
     and (p_asset_type is null or a.asset_type = p_asset_type)
     and (p_job_plan_id is null or a.job_plan_id = p_job_plan_id)
     and (
       p_search is null
       or a.name ilike '%' || p_search || '%'
       or a.asset_type ilike '%' || p_search || '%'
       or a.serial_number ilike '%' || p_search || '%'
       or a.maximo_id ilike '%' || p_search || '%'
       or a.location ilike '%' || p_search || '%'
     );
$$;

comment on function public.get_assets_for_grouping(boolean, text, uuid, text, uuid) is
  'Returns all assets matching the given filters as a single jsonb array. '
  'Bypasses PostgREST db-max-rows cap by returning a scalar value instead of a row set. '
  'Used by the Assets grouped view which needs the full result client-side.';

grant execute on function public.get_assets_for_grouping(boolean, text, uuid, text, uuid) to authenticated;
