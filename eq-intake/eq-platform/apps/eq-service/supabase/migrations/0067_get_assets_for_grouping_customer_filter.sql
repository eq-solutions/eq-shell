-- Migration 0067: Extend get_assets_for_grouping with p_customer_id parameter.
-- Lets the Assets page filter by customer (joins through sites.customer_id).
-- New parameter is nullable; existing callers without it are unchanged.

CREATE OR REPLACE FUNCTION public.get_assets_for_grouping(
  p_show_archived boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_site_id uuid DEFAULT NULL,
  p_asset_type text DEFAULT NULL,
  p_job_plan_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
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
     and (a.site_id is null or s.is_active = true)
     and (p_site_id is null or a.site_id = p_site_id)
     and (p_asset_type is null or a.asset_type = p_asset_type)
     and (p_job_plan_id is null or a.job_plan_id = p_job_plan_id)
     and (p_customer_id is null or s.customer_id = p_customer_id)
     and (
       p_search is null
       or a.name ilike '%' || p_search || '%'
       or a.asset_type ilike '%' || p_search || '%'
       or a.serial_number ilike '%' || p_search || '%'
       or a.maximo_id ilike '%' || p_search || '%'
       or a.location ilike '%' || p_search || '%'
     );
$function$;
