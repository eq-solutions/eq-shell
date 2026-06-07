-- 2026-06-07 — Secure-by-default DEFAULT PRIVILEGES lockdown — EQ FIELD DATA PLANE
-- Plane: eq-canonical-internal (zaap)  ·  zaapmfdkgedqupfjtchl
-- Status: APPLIED 2026-06-07 via Supabase MCP apply_migration, after a read-only census confirmed
--   the same footgun and that flipping it is safe. The `FOR ROLE postgres` line landed and was
--   verified (fresh test table born with NO anon/authenticated grant). The `FOR ROLE supabase_admin`
--   line below is the RESIDUAL — returns `42501 permission denied` as postgres; run from the
--   dashboard SQL editor to fully close.
--
-- Same root cause as the control + SKS planes: pg_default_acl (verified 2026-06-07) showed
--   public · FOR ROLE postgres AND supabase_admin → new tables default-grant FULL CRUD to
--   anon AND authenticated.
--
-- ⚠ FIELD-SPECIFIC CONTEXT: zaap's public schema holds EQ Field's legacy anon-run surface
--   (33 anon/authenticated-granting tables at apply time, ALL with RLS enabled). This change does
--   NOT touch those — ALTER DEFAULT PRIVILEGES only affects tables created AFTER it runs. Their
--   existing exposure is governed by their RLS policies and is handled by the SEPARATE Field anon
--   burn-down to canonical app_data (see KNOWN_LEGACY_ANON in scripts/check-tenant-drift.mjs), not
--   here. Going forward, any new Field public table that needs anon access must grant it EXPLICITLY
--   (new Field work targets app_data, which is already service_role-only / clean).
--
-- service_role unaffected. Reversible via symmetric GRANT.

-- ── public schema — revoke the anon/authenticated full-CRUD default ───────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;  -- APPLIED ✓
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;  -- RESIDUAL: 42501 as postgres — run from dashboard SQL editor

-- ── VERIFY (read-only; expect anon/authenticated gone from the public TABLES default) ──
-- SELECT pg_get_userbyid(defaclrole) AS creator, defaclnamespace::regnamespace AS schema, defaclacl
--   FROM pg_default_acl
--  WHERE defaclobjtype = 'r' AND defaclnamespace::regnamespace::text = 'public'
--  ORDER BY 1;

-- ── ROLLBACK (only if a consumer breaks) ──────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
