-- Migration: 2026_05_25e_revoke_anon_security_definer
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Remove anon/PUBLIC execute privilege from SECURITY DEFINER
--            functions that have no business being called without a valid
--            authenticated JWT.
--
-- Background: PostgreSQL grants EXECUTE to PUBLIC by default on new functions.
-- Most of our SECURITY DEFINER functions in public.* were created without an
-- explicit REVOKE, meaning anon (unauthenticated) callers can invoke them via
-- PostgREST.
--
-- CRITICAL: clear_rate_limit had zero auth guard — an anon caller could clear
-- any rate-limit bucket by key, bypassing PIN brute-force protection entirely.
--
-- Functions kept for anon (login / trigger flow):
--   has_pin, verify_pin, check_and_increment_rate_limit (login flow before JWT)
--   link_pending_invites, lock_invite_accept_columns (auth.users insert trigger)
--   log_licence_change, log_membership_change, log_profile_change (row triggers)
--   is_org_admin, is_org_admin_of (used in RLS policy expressions — revoking
--     would cause permission errors on licences/org_memberships/profiles tables)
--
-- Idempotent (REVOKE is a no-op if privilege already absent).
-- Applied via MCP at 2026-05-25.

-- 1. CRITICAL — rate limit bypass
REVOKE EXECUTE ON FUNCTION public.clear_rate_limit(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clear_rate_limit(text) TO authenticated, service_role;

-- 2. Sensitive data reads — require authenticated JWT
REVOKE EXECUTE ON FUNCTION public.eq_get_tenant_user(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_get_tenant_user(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_intake_event_rows(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_intake_event_rows(uuid, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_list_module_entities(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_list_module_entities(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_list_tenant_users() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_list_tenant_users() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_recent_intake_events(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_recent_intake_events(integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_recent_mint_audit(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_recent_mint_audit(integer) TO authenticated, service_role;

-- 3. Write / admin operations — require authenticated JWT
REVOKE EXECUTE ON FUNCTION public.eq_record_mint(uuid, uuid, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_record_mint(uuid, uuid, text, text, text, text, text, timestamptz) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_revoke_session(text, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_revoke_session(text, text, timestamptz) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_write_audit_log(text, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_write_audit_log(text, uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_provision_tenant_bucket(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_provision_tenant_bucket(uuid) TO authenticated, service_role;

-- 4. Session check — called server-side with service_role, not client anon
REVOKE EXECUTE ON FUNCTION public.eq_is_session_revoked(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_is_session_revoked(text) TO authenticated, service_role;

-- 5. set_pin uses auth.uid() internally — harmless for anon (updates WHERE id = NULL)
--    but there is no reason an unauthenticated caller should reach it.
REVOKE EXECUTE ON FUNCTION public.set_pin(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_pin(text) TO authenticated, service_role;
