-- 2026-06-07 — Secure-by-default DEFAULT PRIVILEGES lockdown — SKS TENANT PLANE
-- Plane: sks-canonical  ·  ehowgjardagevnrluult
-- Status: APPLIED 2026-06-07 via Supabase MCP apply_migration, on Royce's "finish everything"
--   sign-off as the SKS NSW operations authority. The `FOR ROLE postgres` line landed and was
--   verified (fresh test table born with NO anon/authenticated grant). The `FOR ROLE
--   supabase_admin` line returned `42501 permission denied` (runs as postgres) — RESIDUAL, run
--   from the dashboard SQL editor. Confirm with the sks-labour owner that this plane-wide
--   default change is acceptable on the shared plane (it only affects FUTURE tables).
--
-- ⚠ SEPARATE ENTITY. This plane belongs to SKS (not EQ) and is shared by sks-labour.
--   Per the entity-separation rule: never cross-apply this against an EQ plane, and confirm
--   with whoever owns sks-labour before running — a new born-closed default affects every
--   table any app on this plane creates afterwards.
--
-- Same root cause as the control-plane file: pg_default_acl (verified 2026-06-07) shows
--   public · FOR ROLE postgres AND supabase_admin → new tables default-grant FULL CRUD
--   (arwdDxtm) to anon AND authenticated. That is why sks_quotes_* (2026-05-31) and
--   sks_quotes_pricing_* (2026-06-07) shipped anon-open until each was hand-REVOKEd.
--
-- SAFETY: affects only tables created AFTER it runs. Existing tables (incl. the intentional
-- shell_control.eq_schema_registry SELECT read) are untouched. service_role unaffected.

-- ── public schema — revoke the anon/authenticated full-CRUD default ───────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;  -- APPLIED ✓
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;  -- RESIDUAL: 42501 as postgres — run from dashboard SQL editor

-- ── VERIFY (read-only; expect anon/authenticated gone from the public TABLES default) ──
-- SELECT pg_get_userbyid(defaclrole) AS creator, defaclnamespace::regnamespace AS schema, defaclacl
--   FROM pg_default_acl
--  WHERE defaclobjtype = 'r' AND defaclnamespace::regnamespace::text = 'public'
--  ORDER BY 1;

-- ── POST-APPLY PROOF (born-closed) — throwaway txn, expect ZERO rows ──────────────
-- BEGIN;
--   CREATE TABLE public._dpcheck_tmp (id int);
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='_dpcheck_tmp' AND grantee IN ('anon','authenticated');
-- ROLLBACK;

-- ── ROLLBACK (only if a consumer breaks) ──────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
