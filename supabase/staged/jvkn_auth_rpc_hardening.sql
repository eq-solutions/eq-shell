-- jvkn_auth_rpc_hardening.sql   TARGET: jvknxcmbtrfnxfrwfimn (CONTROL PLANE)   GATE: 🔒 auth — Royce sign-off
--
-- FINDING (advisor lint 0028, 2026-05-30): three SECURITY DEFINER admin PIN
-- primitives in shell_control take an ARBITRARY p_user_id with NO caller
-- authorization and carry an `anon` (and `authenticated`) EXECUTE grant:
--
--   shell_control.set_pin_for_user(p_user_id uuid, p_pin text)  -- sets ANY user's PIN
--   shell_control.verify_pin_for_user(p_user_id uuid, p_pin text) -- checks ANY user's PIN, no rate-limit (4-digit brute-force)
--   shell_control.has_pin_for_user(p_user_id uuid)              -- user enumeration
--
-- The ONLY legitimate caller is netlify/functions/cards-api.ts, which runs as
-- service_role (getServiceClient) AFTER verifying the Cards JWT and resolving
-- user_id server-side. The browser never calls these. So anon/authenticated
-- EXECUTE is a misconfiguration, not a needed grant.
--
-- EXPLOITABILITY: likely LATENT — shell_control appears NOT to be REST-exposed
-- (migration 2026_05_25b had to add public.* wrappers because the shell_control
-- originals 404'd from the browser). Confirm via the project's API "Exposed
-- schemas" setting. Latent or not, the correct posture is service_role-only.
--
-- SAFE: service_role retains EXECUTE; Cards PIN setup is unaffected. Reversible.

BEGIN;

REVOKE EXECUTE ON FUNCTION shell_control.set_pin_for_user(uuid, text)    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION shell_control.verify_pin_for_user(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION shell_control.has_pin_for_user(uuid)          FROM anon, authenticated, PUBLIC;

GRANT  EXECUTE ON FUNCTION shell_control.set_pin_for_user(uuid, text)    TO service_role;
GRANT  EXECUTE ON FUNCTION shell_control.verify_pin_for_user(uuid, text) TO service_role;
GRANT  EXECUTE ON FUNCTION shell_control.has_pin_for_user(uuid)          TO service_role;

-- Tenant-scoped (filters by jwt app_metadata tenant_id) so anon gets nothing, but
-- only the public wrapper should reach it — drop the redundant anon grant too.
REVOKE EXECUTE ON FUNCTION shell_control.eq_recent_auth_events(integer)  FROM anon, PUBLIC;

COMMIT;

-- VERIFY (expect false, false, false):
--   SELECT has_function_privilege('anon','shell_control.set_pin_for_user(uuid,text)','EXECUTE'),
--          has_function_privilege('authenticated','shell_control.verify_pin_for_user(uuid,text)','EXECUTE'),
--          has_function_privilege('anon','shell_control.has_pin_for_user(uuid)','EXECUTE');
