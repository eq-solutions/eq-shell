-- Backfill: eq_get_org_licences (jvkn control-plane source-control parity)
--
-- This function was applied directly to jvkn via Supabase MCP during the
-- EQ Field consent-gated worker-licence read sprint (v3.5.189, 2026-06-25).
-- It is LIVE and correct on jvkn; this migration records it in source control
-- only. CREATE OR REPLACE is idempotent — no DB change on re-run.
--
-- Scope: public schema on jvkn (eq-canonical control plane).
-- Do NOT add to supabase/tenant-migrations/ — this is not a tenant-DB function.
--
-- Security model: SECURITY DEFINER with pinned search_path. Caller supplies
-- p_org_id; the function filters on org_memberships.status = 'active' and
-- l.is_private = false — no row-level auth.uid() check needed because
-- EQ Field calls this via the service-role path after verifying the caller's
-- consent grant server-side. anon/authenticated EXECUTE is intentional for
-- the consent-gated Field iframe read path.

CREATE OR REPLACE FUNCTION public.eq_get_org_licences(p_org_id uuid)
RETURNS TABLE(
  licence_id         uuid,
  worker_id          uuid,
  staff_id           uuid,
  worker_user_id     uuid,
  worker_first_name  text,
  worker_last_name   text,
  worker_email       text,
  worker_phone       text,
  licence_type       text,
  licence_number     text,
  issue_date         date,
  expiry_date        date,
  never_expires      boolean,
  state              text,
  issuing_authority  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.id, w.id, w.staff_id, w.user_id, w.first_name, w.last_name, w.email, w.phone,
         l.licence_type, l.licence_number, l.issue_date, l.expiry_date,
         COALESCE(l.never_expires, false), l.state, l.issuing_authority
  FROM   public.licences l
  JOIN   public.workers w          ON w.user_id = l.user_id
  JOIN   public.org_memberships om ON om.user_id = w.user_id
                                   AND om.org_id = p_org_id AND om.status = 'active'
  WHERE  l.deleted_at IS NULL AND l.user_id IS NOT NULL AND NOT l.is_private
  ORDER  BY w.last_name, w.first_name, l.expiry_date NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.eq_get_org_licences(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.eq_get_org_licences(uuid) TO anon, authenticated;
