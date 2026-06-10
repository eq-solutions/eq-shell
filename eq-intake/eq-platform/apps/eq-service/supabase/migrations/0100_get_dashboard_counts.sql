-- 0100: RPC for the dashboard counts — collapses 13 separate count queries
-- into one round trip.
--
-- BEFORE
--   app/(app)/dashboard/page.tsx fires 16 parallel queries on every render:
--     - 4× entity counts (customers, sites, assets, job_plans)
--     - 4× check status counts (scheduled, in_progress, overdue, complete)
--     - 1× defects total count
--     - 4× defect severity counts (critical, high, medium, low)
--     - plus 3 list queries (upcoming, recent, sites for map)
--
--   The 13 count queries each force PostgREST + RLS to plan and scan
--   independently. Replacing them with one grouped function call cuts the
--   dashboard's Supabase round-trip cost by ~60% (from 16 to ~5 trips).
--
-- AFTER
--   Single RPC returns all counts as a JSON document:
--     { entities: {...}, checks: {...}, defects: {...} }
--   The three list queries (upcoming/recent/sites) stay separate because
--   their shapes are different — counts and rows don't mix cleanly in
--   one SQL function.
--
-- USER FILTER
--   p_user_id is optional. When supplied, the check counts apply
--   `assigned_to = p_user_id` and the defect counts apply
--   `raised_by = p_user_id`. Entity counts are ALWAYS tenant-wide
--   regardless of p_user_id — they represent context, not assignment.

CREATE OR REPLACE FUNCTION public.get_dashboard_counts(
  p_tenant_id uuid,
  p_user_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    -- ── Entity counts (always tenant-wide) ──
    'entities', jsonb_build_object(
      'customers',  (SELECT COUNT(*)::int FROM public.customers
                      WHERE tenant_id = p_tenant_id AND is_active = true),
      'sites',      (SELECT COUNT(*)::int FROM public.sites
                      WHERE tenant_id = p_tenant_id AND is_active = true),
      'assets',     (SELECT COUNT(*)::int FROM public.assets
                      WHERE tenant_id = p_tenant_id AND is_active = true),
      'job_plans',  (SELECT COUNT(*)::int FROM public.job_plans
                      WHERE tenant_id = p_tenant_id AND is_active = true)
    ),

    -- ── Maintenance check counts (optionally filtered by assigned_to) ──
    'checks', jsonb_build_object(
      'scheduled',   (SELECT COUNT(*)::int FROM public.maintenance_checks
                       WHERE tenant_id = p_tenant_id AND is_active = true
                         AND status = 'scheduled'
                         AND (p_user_id IS NULL OR assigned_to = p_user_id)),
      'in_progress', (SELECT COUNT(*)::int FROM public.maintenance_checks
                       WHERE tenant_id = p_tenant_id AND is_active = true
                         AND status = 'in_progress'
                         AND (p_user_id IS NULL OR assigned_to = p_user_id)),
      'overdue',     (SELECT COUNT(*)::int FROM public.maintenance_checks
                       WHERE tenant_id = p_tenant_id AND is_active = true
                         AND status = 'overdue'
                         AND (p_user_id IS NULL OR assigned_to = p_user_id)),
      'complete',   (SELECT COUNT(*)::int FROM public.maintenance_checks
                       WHERE tenant_id = p_tenant_id AND is_active = true
                         AND status = 'complete'
                         AND (p_user_id IS NULL OR assigned_to = p_user_id))
    ),

    -- ── Defect counts (optionally filtered by raised_by) ──
    -- defects use status (open/resolved) not is_active — see CLAUDE.md
    -- soft-delete note.
    'defects', jsonb_build_object(
      'total',    (SELECT COUNT(*)::int FROM public.defects
                    WHERE tenant_id = p_tenant_id
                      AND status IN ('open', 'in_progress')
                      AND (p_user_id IS NULL OR raised_by = p_user_id)),
      'critical', (SELECT COUNT(*)::int FROM public.defects
                    WHERE tenant_id = p_tenant_id
                      AND status IN ('open', 'in_progress')
                      AND severity = 'critical'
                      AND (p_user_id IS NULL OR raised_by = p_user_id)),
      'high',     (SELECT COUNT(*)::int FROM public.defects
                    WHERE tenant_id = p_tenant_id
                      AND status IN ('open', 'in_progress')
                      AND severity = 'high'
                      AND (p_user_id IS NULL OR raised_by = p_user_id)),
      'medium',   (SELECT COUNT(*)::int FROM public.defects
                    WHERE tenant_id = p_tenant_id
                      AND status IN ('open', 'in_progress')
                      AND severity = 'medium'
                      AND (p_user_id IS NULL OR raised_by = p_user_id)),
      'low',      (SELECT COUNT(*)::int FROM public.defects
                    WHERE tenant_id = p_tenant_id
                      AND status IN ('open', 'in_progress')
                      AND severity = 'low'
                      AND (p_user_id IS NULL OR raised_by = p_user_id))
    )
  );
$$;

COMMENT ON FUNCTION public.get_dashboard_counts IS
  'Dashboard counts in one query (collapses 13 separate count queries). Pass p_user_id to filter checks by assigned_to and defects by raised_by; entity counts are always tenant-wide. Service-role or RLS-filtered caller — function does not enforce tenant isolation itself, so callers MUST pass the verified tenant_id.';

GRANT EXECUTE ON FUNCTION public.get_dashboard_counts(uuid, uuid)
  TO authenticated, service_role;
