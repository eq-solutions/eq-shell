-- 0099: RPC for the customer monthly summary cron — collapses the N+1 fan-out.
--
-- BEFORE
--   /api/cron/dispatch-notifications runs every 15 minutes. For each
--   customer-monthly-summary recipient, it fires:
--     - 1× contact lookup
--     - 6× parallel KPI queries (visits_done, visits_upcoming, defects_open,
--       defects_raised, vars_approved, sites)
--     - For each of up to 20 sites: 3× more queries (visits this period,
--       next visit date, open defects)
--
--   Net: ~67 queries per recipient. At 10 tenants × 5 recipients each =
--   3,350 queries per 15-min tick (~13,400/hour). Hit Supabase pooler
--   limits well before commercial-tier customer load demanded it.
--
-- AFTER
--   One RPC call per recipient returns all KPIs + per-site array as a
--   single JSON document. 50 recipients = 50 queries per tick.
--
-- RLS note
--   The cron uses the service-role admin client (bypasses RLS), so this
--   function does not enforce RLS itself. If a future caller is not
--   service-role, wrap the access pattern accordingly.

CREATE OR REPLACE FUNCTION public.get_customer_period_summary(
  p_tenant_id     uuid,
  p_customer_id   uuid,
  p_period_start  timestamptz,
  p_period_end    timestamptz
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH
  -- ── Tenant-wide KPIs (not customer-scoped) ─────────────────────
  tenant_visits_done AS (
    SELECT COUNT(*)::int AS n
    FROM public.maintenance_checks
    WHERE tenant_id = p_tenant_id
      AND status = 'complete'
      AND completed_at BETWEEN p_period_start AND p_period_end
      AND is_active = true
  ),
  tenant_visits_upcoming AS (
    SELECT COUNT(*)::int AS n
    FROM public.maintenance_checks
    WHERE tenant_id = p_tenant_id
      AND status IN ('scheduled', 'in_progress')
      AND is_active = true
  ),
  tenant_defects_open AS (
    SELECT COUNT(*)::int AS n
    FROM public.defects
    WHERE tenant_id = p_tenant_id
      AND status IN ('open', 'in_progress')
  ),
  tenant_defects_raised AS (
    SELECT COUNT(*)::int AS n
    FROM public.defects
    WHERE tenant_id = p_tenant_id
      AND created_at BETWEEN p_period_start AND p_period_end
  ),
  -- ── Customer-scoped KPIs ───────────────────────────────────────
  customer_vars_approved AS (
    SELECT COUNT(*)::int AS n
    FROM public.contract_variations
    WHERE tenant_id   = p_tenant_id
      AND customer_id = p_customer_id
      AND status      = 'approved'
      AND approved_at BETWEEN p_period_start AND p_period_end
  ),
  -- ── Per-site rows (up to 20, alphabetical) ─────────────────────
  customer_sites AS (
    SELECT id, name
    FROM public.sites
    WHERE customer_id = p_customer_id
      AND is_active   = true
    ORDER BY name
    LIMIT 20
  ),
  per_site_rows AS (
    SELECT
      s.id,
      s.name,
      (SELECT COUNT(*)::int FROM public.maintenance_checks mc
        WHERE mc.site_id = s.id
          AND mc.status = 'complete'
          AND mc.completed_at BETWEEN p_period_start AND p_period_end
          AND mc.is_active = true)                                AS visits_this_period,
      (SELECT mc.due_date FROM public.maintenance_checks mc
        WHERE mc.site_id = s.id
          AND mc.status IN ('scheduled', 'in_progress')
          AND mc.is_active = true
        ORDER BY mc.due_date ASC
        LIMIT 1)                                                  AS next_visit_date,
      (SELECT COUNT(*)::int FROM public.defects d
        WHERE d.site_id = s.id
          AND d.status IN ('open', 'in_progress'))                AS open_defects
    FROM customer_sites s
  )
  SELECT jsonb_build_object(
    'visits_done',     (SELECT n FROM tenant_visits_done),
    'visits_upcoming', (SELECT n FROM tenant_visits_upcoming),
    'defects_open',    (SELECT n FROM tenant_defects_open),
    'defects_raised',  (SELECT n FROM tenant_defects_raised),
    'vars_approved',   (SELECT n FROM customer_vars_approved),
    'per_site',        COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'site_name',           name,
        'visits_this_period',  visits_this_period,
        'next_visit_date',     next_visit_date,
        'open_defects',        open_defects
      ) ORDER BY name) FROM per_site_rows),
      '[]'::jsonb
    )
  );
$$;

COMMENT ON FUNCTION public.get_customer_period_summary IS
  'Customer monthly summary KPIs + per-site rows in one query. Used by /api/cron/dispatch-notifications to collapse the 67-queries-per-recipient N+1. Service-role caller; no RLS enforcement inside.';

-- Service role + authenticated users (the cron uses service_role; any
-- future authenticated caller will hit RLS via the tables underneath).
GRANT EXECUTE ON FUNCTION public.get_customer_period_summary(uuid, uuid, timestamptz, timestamptz)
  TO service_role, authenticated;
