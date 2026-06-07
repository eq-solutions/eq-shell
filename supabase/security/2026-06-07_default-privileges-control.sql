-- 2026-06-07 — Secure-by-default DEFAULT PRIVILEGES lockdown — CONTROL PLANE (EQ entity)
-- Plane: eq-canonical / control plane  ·  jvknxcmbtrfnxfrwfimn
-- Status: APPLIED 2026-06-07 via Supabase MCP apply_migration. The two `FOR ROLE postgres`
--   lines landed and were verified (census shows anon/authenticated removed from the public +
--   shell_control defaults; a fresh test table was born with NO anon/authenticated grant).
--   The `FOR ROLE supabase_admin` line below returned `42501 permission denied` (the migration
--   runs as postgres, which is not a member of supabase_admin) — it is a RESIDUAL, not load-
--   bearing: every app migration creates tables as postgres, so the postgres lines cover the
--   real creation path. Run the supabase_admin line from the dashboard SQL editor to fully close it.
--
-- ROOT-CAUSE fix for the recurring "new table born anon/authenticated-open" class
-- (2026-05-31 sks_quotes_*, 2026-06-07 sks_quotes_pricing_* + shell_control.tenant_role_overrides).
-- Those individual tables are already patched live; this flips the underlying default
-- posture so future tables are born CLOSED instead of having to be remembered-to-REVOKE.
--
-- Diagnosis (pg_default_acl, verified 2026-06-07):
--   public        · FOR ROLE postgres AND supabase_admin → new tables default-grant FULL CRUD
--                   (arwdDxtm) to anon AND authenticated.
--   shell_control · FOR ROLE postgres → new tables default-grant SELECT to authenticated
--                   (this is why tenant_role_overrides shipped with a cross-tenant authd SELECT).
--
-- SAFETY: ALTER DEFAULT PRIVILEGES only affects tables created AFTER it runs. Existing
-- intentional bootstrap reads (public.organisations, public.module_entitlements,
-- shell_control.eq_schema_registry — all in INTENTIONAL_ANON_READS, SELECT-only via policy)
-- are NOT touched and keep working. service_role is never altered here.
--
-- Reversible: re-run the symmetric GRANT form to restore (see rollback at the bottom).

-- ── public schema — revoke the anon/authenticated full-CRUD default ───────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public        REVOKE ALL    ON TABLES FROM anon, authenticated;  -- APPLIED ✓
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public        REVOKE ALL    ON TABLES FROM anon, authenticated;  -- RESIDUAL: 42501 as postgres — run from dashboard SQL editor

-- ── shell_control schema — revoke the authenticated SELECT default ────────────────
-- (No anon default exists on shell_control; this is the one that leaked tenant_role_overrides.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA shell_control REVOKE SELECT ON TABLES FROM authenticated;  -- APPLIED ✓

-- ── VERIFY (run as a read-only check; expect anon/authenticated to disappear from the ACL) ──
-- SELECT pg_get_userbyid(defaclrole) AS creator, defaclnamespace::regnamespace AS schema, defaclacl
--   FROM pg_default_acl
--  WHERE defaclobjtype = 'r'
--    AND defaclnamespace::regnamespace::text IN ('public','shell_control')
--  ORDER BY 1,2;
-- Confirm no entry for this plane still lists `anon=...` or `authenticated=...` on TABLES.

-- ── POST-APPLY PROOF (born-closed) — run in a throwaway txn, expect ZERO rows ──────
-- BEGIN;
--   CREATE TABLE public._dpcheck_tmp (id int);
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='_dpcheck_tmp' AND grantee IN ('anon','authenticated');
-- ROLLBACK;

-- ── ROLLBACK (only if a consumer breaks) ──────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public        GRANT ALL    ON TABLES TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public        GRANT ALL    ON TABLES TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA shell_control GRANT SELECT ON TABLES TO authenticated;
