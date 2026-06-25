-- B2: re-gate eq_field_get_worker_summary with org-membership check
--
-- BEFORE: gate used auth.uid() — EQ Field calls this anon so it always
-- returned zero rows, leaving the "Cards Record" panel blank for every worker.
--
-- AFTER: caller supplies p_org_id; function checks the worker is an active
-- member of that org before returning right-to-work + emergency contact.
-- Same privacy model as eq_get_org_licences (approved, live, 2026-06-25).
--
-- APPLY TO: jvkn (eq-canonical control plane) via Supabase MCP after merge.
-- This is NOT a tenant migration — do not add to supabase/tenant-migrations/.
--
-- Signature change (uuid) → (uuid, uuid):
--   DROP the old 1-arg overload first so both don't coexist.
--   No current callers of the 1-arg version exist in eq-shell (grep confirmed).
--   EQ Field people.js caller is the only consumer; it requires the Field-side
--   update to pass p_org_id (tracked as a follow-on task in eq-field).

DROP FUNCTION IF EXISTS public.eq_field_get_worker_summary(uuid);

CREATE OR REPLACE FUNCTION public.eq_field_get_worker_summary(
  p_worker_id uuid,
  p_org_id    uuid
)
RETURNS TABLE(
  cards_claimed           boolean,
  right_to_work_type      text,
  right_to_work_expiry    date,
  emergency_contact_name  text,
  emergency_contact_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (w.user_id IS NOT NULL)    AS cards_claimed,
    w.right_to_work_type::text AS right_to_work_type,
    w.right_to_work_expiry     AS right_to_work_expiry,
    w.emergency_contact_name   AS emergency_contact_name,
    w.emergency_contact_phone  AS emergency_contact_phone
  FROM  public.workers w
  JOIN  public.org_memberships om
    ON  om.user_id = w.user_id
   AND  om.org_id  = p_org_id
   AND  om.status  = 'active'
  WHERE w.id = p_worker_id;
$$;

REVOKE ALL ON FUNCTION public.eq_field_get_worker_summary(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.eq_field_get_worker_summary(uuid, uuid) TO anon, authenticated;
