-- H-01 (security hardening sprint, 2026-06-27): make check_and_increment_rate_limit
-- service-role-only.
--
-- Confirmed live 2026-06-27: EXECUTE granted to `authenticated` (anon already false).
-- The shell mints a role:authenticated Supabase JWT to every logged-in user, and the
-- rate-limit keys are guessable (totp::<user_id>, login::<ip>, magic-link::<email>,
-- phone-otp::<phone>) with a caller-supplied p_lockout_secs — so any authenticated user
-- can POST /rest/v1/rpc/check_and_increment_rate_limit and lock any victim out of
-- login/2FA for up to a year. clear_rate_limit is already authenticated=false, so the
-- victim cannot self-unlock. The function is only ever called via the service-role
-- client inside Netlify functions (login / totp / magic-link / cards-api), which is
-- unaffected by this revoke.
--
-- PRE-APPLY CHECK: confirm no browser/Cards code calls this RPC with the anon/user JWT
-- directly (the in-repo cards-api call uses the service client). Apply on jvkn via the
-- governed path; NOT auto-applied on merge. Scope: public schema on jvkn. NOT a tenant
-- migration — do NOT add to supabase/tenant-migrations/.

REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer, integer) FROM anon, authenticated;
