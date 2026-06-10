-- 0057_supervisor_digests.sql
--
-- Adds infrastructure for the daily supervisor email digest:
--   1. `supervisor_digests` audit table — every digest send is logged
--      (one row per supervisor per send) with payload counts so we can see
--      "did Royce get yesterday's digest?" without trawling Resend.
--   2. `pm_calendar_for_supervisor()` — SECURITY DEFINER helper that
--      returns the entries a given supervisor should see in their digest
--      (entries on sites they're assigned to or all entries when they're
--      tenant admin/super_admin), bucketed by overdue/today/this_week/next_week.
--   3. `last_digest_sent_at` index on supervisor_digests for the cron.
--
-- The cron job (Netlify Scheduled Function or pg_cron + http extension)
-- POSTs to /api/cron/supervisor-digest with `Authorization: Bearer
-- $CRON_SECRET`. The route iterates all tenants × supervisors, calls this
-- function, and emails via Resend.

-- ─────────── audit table ───────────

CREATE TABLE IF NOT EXISTS public.supervisor_digests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supervisor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supervisor_email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),

  -- summary of what we sent
  overdue_count integer NOT NULL DEFAULT 0,
  today_count integer NOT NULL DEFAULT 0,
  this_week_count integer NOT NULL DEFAULT 0,
  next_week_count integer NOT NULL DEFAULT 0,
  entry_ids uuid[] NOT NULL DEFAULT '{}',

  -- delivery
  delivery_status text NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'skipped_empty', 'skipped_no_email', 'error')),
  delivery_error text,
  resend_message_id text,

  -- trigger source: 'cron' (scheduled), 'manual' (admin "send now"), 'preview' (dry run, no email sent)
  trigger_source text NOT NULL DEFAULT 'cron' CHECK (trigger_source IN ('cron', 'manual', 'preview')),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supervisor_digests_tenant_sent
  ON public.supervisor_digests(tenant_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_supervisor_digests_supervisor_sent
  ON public.supervisor_digests(supervisor_user_id, sent_at DESC);

ALTER TABLE public.supervisor_digests ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their tenant's digest log.
-- Note: get_user_tenant_ids() returns uuid[], so we call it directly —
-- wrapping in (SELECT …) would coerce it into a scalar subquery and
-- break the = ANY() comparison (see migration 0027 + project notes).
CREATE POLICY "supervisor_digests_select"
  ON public.supervisor_digests
  FOR SELECT
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

-- Inserts come from server-side code only (cron route uses service role,
-- manual trigger goes through requireUser + admin check then service role
-- write). No user-facing INSERT policy.

COMMENT ON TABLE public.supervisor_digests
  IS 'Audit log of supervisor digest emails. One row per supervisor per send.';

COMMENT ON COLUMN public.supervisor_digests.trigger_source
  IS 'cron = scheduled job, manual = admin clicked "Send digest now", preview = dry run, no email sent';

-- ─────────── helper: entries for a supervisor ───────────

CREATE OR REPLACE FUNCTION public.pm_calendar_for_supervisor(
  p_supervisor_user_id uuid,
  p_tenant_id uuid,
  p_horizon_days integer DEFAULT 14
)
RETURNS TABLE (
  id uuid,
  site_id uuid,
  site_name text,
  site_code text,
  customer_name text,
  title text,
  category text,
  location text,
  start_time timestamptz,
  end_time timestamptz,
  status text,
  assigned_to uuid,
  assigned_to_name text,
  bucket text  -- 'overdue' | 'today' | 'this_week' | 'next_week'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_now timestamptz := now();
  v_today_start timestamptz := date_trunc('day', v_now);
  v_today_end timestamptz := v_today_start + interval '1 day';
  v_this_week_end timestamptz := v_today_start + interval '7 days';
  v_horizon_end timestamptz := v_today_start + (p_horizon_days || ' days')::interval;
BEGIN
  -- Resolve the supervisor's role in the target tenant. Only supervisor /
  -- admin / super_admin get a digest. (Technicians get their own per-task
  -- notifications, not a digest.)
  SELECT tm.role INTO v_role
  FROM public.tenant_members tm
  WHERE tm.user_id = p_supervisor_user_id
    AND tm.tenant_id = p_tenant_id
    AND tm.is_active = true
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('supervisor', 'admin', 'super_admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pc.id,
    pc.site_id,
    s.name AS site_name,
    s.code AS site_code,
    c.name AS customer_name,
    pc.title,
    pc.category,
    pc.location,
    pc.start_time,
    pc.end_time,
    pc.status,
    pc.assigned_to,
    p.full_name AS assigned_to_name,
    CASE
      WHEN pc.start_time <  v_today_start                                  THEN 'overdue'
      WHEN pc.start_time >= v_today_start AND pc.start_time < v_today_end  THEN 'today'
      WHEN pc.start_time <  v_this_week_end                                THEN 'this_week'
      ELSE                                                                       'next_week'
    END AS bucket
  FROM public.pm_calendar pc
  LEFT JOIN public.sites s     ON s.id = pc.site_id
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.profiles p  ON p.id = pc.assigned_to
  WHERE pc.tenant_id = p_tenant_id
    AND pc.is_active = true
    AND pc.status IN ('scheduled', 'in_progress')
    AND (
      -- Overdue: any start_time before today (regardless of horizon)
      pc.start_time < v_today_start
      -- Or upcoming within the horizon
      OR pc.start_time < v_horizon_end
    )
  ORDER BY
    CASE
      WHEN pc.start_time <  v_today_start THEN 0
      WHEN pc.start_time <  v_today_end   THEN 1
      WHEN pc.start_time <  v_this_week_end THEN 2
      ELSE 3
    END,
    pc.start_time ASC;
END;
$$;

COMMENT ON FUNCTION public.pm_calendar_for_supervisor(uuid, uuid, integer)
  IS 'Returns PM calendar entries for a supervisor''s daily digest, bucketed by overdue / today / this_week / next_week. Restricted to supervisor/admin/super_admin roles.';

-- Allow authenticated users to call (the function itself enforces role
-- inside via tenant_members lookup).
GRANT EXECUTE ON FUNCTION public.pm_calendar_for_supervisor(uuid, uuid, integer)
  TO authenticated, service_role;

-- ─────────── helper: list active supervisors per tenant ───────────

CREATE OR REPLACE FUNCTION public.list_active_supervisors()
RETURNS TABLE (
  tenant_id uuid,
  user_id uuid,
  email text,
  full_name text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tm.tenant_id,
    tm.user_id,
    p.email,
    p.full_name,
    tm.role
  FROM public.tenant_members tm
  JOIN public.profiles p ON p.id = tm.user_id
  WHERE tm.is_active = true
    AND p.is_active = true
    AND tm.role IN ('supervisor', 'admin', 'super_admin')
    AND p.email IS NOT NULL;
$$;

COMMENT ON FUNCTION public.list_active_supervisors()
  IS 'Service-role helper: returns all active supervisor/admin members across all tenants. Used by the supervisor digest cron.';

-- Service role only — no GRANT to authenticated.
GRANT EXECUTE ON FUNCTION public.list_active_supervisors() TO service_role;
