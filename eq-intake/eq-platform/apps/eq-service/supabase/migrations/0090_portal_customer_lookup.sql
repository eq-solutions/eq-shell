-- ============================================================
-- Migration 0090: Portal-side helpers for resolving the current user
-- (auth.users row) to the customer they belong to.
--
-- The portal uses magic-link auth — users have an auth.users row but
-- no tenant_members row. All portal pages filter by customer_id =
-- get_portal_customer_id() and tenant_id = get_portal_tenant_id().
--
-- Both functions return NULL if the auth user's email isn't in
-- customer_contacts. Portal pages handle that case by showing an
-- empty / login-redirect state.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_portal_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT cc.customer_id
    FROM public.customer_contacts cc
    JOIN auth.users u ON lower(u.email) = lower(cc.email)
   WHERE u.id = auth.uid()
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_portal_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_portal_customer_id() TO authenticated;

COMMENT ON FUNCTION public.get_portal_customer_id IS
  'Resolves the customer_id the portal user belongs to via email match against customer_contacts. NULL if no match. Used by portal pages.';

CREATE OR REPLACE FUNCTION public.get_portal_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT cc.tenant_id
    FROM public.customer_contacts cc
    JOIN auth.users u ON lower(u.email) = lower(cc.email)
   WHERE u.id = auth.uid()
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_portal_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_portal_tenant_id() TO authenticated;

COMMENT ON FUNCTION public.get_portal_tenant_id IS
  'Resolves the tenant_id the portal user is associated with (via customer). NULL if no match.';
