-- Migration: 2026_06_07c_default_privileges_anon_lockdown
-- Target:    SHARED eq-canonical control plane (jvknxcmbtrfnxfrwfimn) ONLY.
--
-- Purpose:   Close the "born-exposed" default-privilege footgun on the control
--            plane. New tables CREATEd in shell_control / public by the migration
--            runner (role: postgres) inherit anon/authenticated grants from the
--            plane's default privileges, so a table ships readable across ALL
--            tenants the moment it is created — with RLS off by default. The same
--            footgun was previously seen on sks-canonical.
--
-- ── VERIFIED LIVE 2026-06-07 (read-only, via Supabase MCP) ───────────────────
--   pg_default_acl on jvkn confirms the footgun is STILL ACTIVE for new tables:
--     · shell_control  tables, grantor postgres:  authenticated = SELECT (r)
--     · public         tables, grantor postgres:  anon = ALL, authenticated = ALL
--     · public         tables, grantor supabase_admin: anon = ALL, authenticated = ALL
--   (objtype 'r'. ALL = arwdDxtm.) The shell_control authenticated=SELECT default
--   is exactly what leaked shell_control.tenant_role_overrides.
--
--   Every already-created table is ALREADY locked down live (RLS on, 0 policies,
--   no anon/authenticated grants) — confirmed for tenant_role_overrides,
--   security_groups / security_group_perms / user_security_groups, AND
--   public.tenants (so Lane B's tenants fix is applied). The anon-grant sweep
--   (scripts/check-tenant-drift.mjs ANON_GRANT_SQL) returns ONLY the three
--   intentional bootstrap reads (public.organisations, public.module_entitlements,
--   shell_control.eq_schema_registry). So the ONLY outstanding live exposure is
--   the DEFAULT itself — the next table born in either schema is the risk.
--
-- What this migration does:
--   PART A — REVOKE the default privilege so FUTURE shell_control/public tables
--            are not born with anon/authenticated grants. This is the real fix;
--            it is NOT yet applied live.
--   PART B — Repo/lineage PARITY for the security_groups sibling set. These were
--            created 2026-06-01 with no RLS / no revoke and were locked down live
--            OUT OF BAND (like tenant_role_overrides), but their CREATE migration
--            (2026_06_01_security_groups.sql) still omits it — so a fresh
--            control-plane provision would reopen the hole. PART B makes the
--            posture travel in the repo. It is a NO-OP against current live state
--            (idempotent). Mirrors the 2026_06_07b tenant_role_overrides lockdown
--            pattern (separate follow-on migration sorting after the create).
--            Access path is service-role-only — netlify/functions/security-groups.ts
--            getServiceClient(), admin.manage_groups-gated, tenant-scoped in code;
--            no browser/anon path, so RLS-no-policy is correct (service_role
--            bypasses RLS).
--
-- Does NOT touch:
--   · Schema-level USAGE for anon/authenticated (verified live: all true for
--     public + shell_control). Login bootstrap reads public.organisations +
--     public.module_entitlements and anon reads shell_control.eq_schema_registry,
--     all of which need schema USAGE. See INTENTIONAL_ANON_READS in
--     scripts/check-tenant-drift.mjs.
--   · Existing tables. Changing the DEFAULT only affects tables created AFTER
--     this runs; grants already materialised on existing tables are untouched, so
--     the three intentional anon-read tables keep working.
--   · The supabase_admin-grantor public default (see caveat) and the FUNCTION /
--     SEQUENCE defaults (see "Related, out of scope").
--
-- Grantor caveat (CONFIRMED real here): ALTER DEFAULT PRIVILEGES is keyed to the
--   role that CREATEs the object. public has the bad default for BOTH `postgres`
--   AND `supabase_admin`. The One-Pipe runner, the governed apply, and the
--   dashboard all create as `postgres`, so the unqualified form below (current
--   role = postgres) covers every table WE create. The `supabase_admin` default
--   cannot be altered from here — `postgres` is not superuser and not a member of
--   supabase_admin — and governs only tables supabase_admin itself creates
--   (Supabase-managed internals), not app tables. Left as a documented platform
--   residual; do NOT add `FOR ROLE supabase_admin` (it errors and rolls back).
--
-- Related, out of scope: the public FUNCTION default also grants anon/authenticated
--   EXECUTE on new functions (pg_default_acl objtype 'f'), which is why the
--   security advisor flags the eq_cards_* SECDEF functions as anon/authenticated
--   executable. That is a separate remediation (per-function REVOKE + search_path)
--   already tracked under the wave-1 SECDEF work — NOT folded in here (scope =
--   the table-read footgun).
--
-- Governance: CONTROL-PLANE change. Author-only in this repo. Apply ONLY via the
--   governed control-plane path (supabase/migrations + governed apply) — NOT by
--   hand, NOT via the Supabase dashboard / Supabase MCP. Idempotent: every
--   statement is a no-op if already in the target state.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART A — stop future tables being born with anon/authenticated grants  (LIVE FIX)
-- ════════════════════════════════════════════════════════════════════════════
-- Mirrors supabase/security/2026-06-03_field-anon-lockdown.sql:24 (public, data
-- plane) and supabase/tenant-migrations/0001_baseline.sql:39-41 (app_data →
-- service_role only). Unqualified form = current role (postgres) — the grantor
-- whose default governs every table the runner/dashboard creates.
ALTER DEFAULT PRIVILEGES IN SCHEMA shell_control REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public        REVOKE ALL ON TABLES FROM anon, authenticated;

-- Keep service_role the implicit grantee for new shell_control tables (parity
-- with 2026_05_24_tenant_routing.sql:84; harmless no-op — already present live).
ALTER DEFAULT PRIVILEGES IN SCHEMA shell_control GRANT ALL ON TABLES TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — security_groups sibling set: repo/lineage parity  (NO-OP vs live)
-- ════════════════════════════════════════════════════════════════════════════
-- Already locked down live out of band; this brings the repo into line so a fresh
-- provision is born secure. service_role bypasses RLS → no policy needed.
REVOKE ALL ON shell_control.security_groups      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON shell_control.security_group_perms FROM anon, authenticated, PUBLIC;
REVOKE ALL ON shell_control.user_security_groups FROM anon, authenticated, PUBLIC;

GRANT ALL ON shell_control.security_groups      TO service_role;
GRANT ALL ON shell_control.security_group_perms TO service_role;
GRANT ALL ON shell_control.user_security_groups TO service_role;

ALTER TABLE shell_control.security_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shell_control.security_group_perms ENABLE ROW LEVEL SECURITY;
ALTER TABLE shell_control.user_security_groups ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION (run as READS via the Supabase MCP / Management API):
--
-- 1. PART A took — no postgres-grantor table default should grant anon/auth:
--      SELECT pg_get_userbyid(d.defaclrole) AS grantor, n.nspname AS schema,
--             d.defaclacl::text AS default_acl
--      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
--      WHERE n.nspname IN ('public','shell_control') AND d.defaclobjtype = 'r';
--    Expect: grantor=postgres rows show only service_role (and postgres). The
--    grantor=supabase_admin public row is the documented residual (unchanged).
--
-- 2. Full sibling sweep stays clean apart from the intentional reads:
--      node scripts/check-tenant-drift.mjs --anon-only
--    (CONTROL_PROJECT_REF=jvknxcmbtrfnxfrwfimn, SUPABASE_ACCESS_TOKEN set.)
--
-- 3. Schema USAGE unchanged (login bootstrap):
--      SELECT has_schema_privilege('anon','public','USAGE'),
--             has_schema_privilege('anon','shell_control','USAGE');   -- both true
-- ────────────────────────────────────────────────────────────────────────────
