-- Migration: 2026_05_24d_post_drop_app_data_cleanup
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Hotfix follow-up to 2026_05_24c_drop_shared_app_data.
--
-- After we dropped `app_data CASCADE`, prod login (and every other
-- shell-control REST call) started returning 503 from PostgREST and
-- shell-login surfaced it as {"error":"Database error"} 500. Two
-- leftover artefacts referenced the now-missing schema and prevented
-- PostgREST from successfully loading its schema cache:
--
--   1. Twelve stale `public.*` functions whose bodies still pointed at
--      `app_data.*` tables. These were superseded by per-tenant RPCs
--      during Phase 2.B.6 but never deleted. Every PostgREST connection
--      threw `ERROR: schema "app_data" does not exist` while reading
--      pg_proc bodies into the cache.
--
--   2. `app_data` was still listed in the project's PostgREST
--      `db-schemas` exposed-schemas config. With the schema physically
--      gone, PostgREST's startup query for that schema's objects also
--      threw the same error.
--
-- This migration captures the hotfix that was applied via MCP at
-- 20:30 UTC 2026-05-24 so the prod state is reproducible from source.
--
-- (1) is fixed here by DROPping the orphans.
--
-- (2) is fixed BY-HAND in the Supabase dashboard (Settings → API →
-- "Exposed schemas"). Removing `app_data` from that list is not a SQL
-- operation — it lives in the project's API config. The `CREATE SCHEMA
-- IF NOT EXISTS app_data` below is a belt-and-braces no-op once the
-- dashboard change is made; it costs nothing to keep the empty schema
-- around as a safety net in case the exposed-schemas list ever drifts
-- back. Drop the schema explicitly in a follow-up migration once the
-- dashboard change has been confirmed in prod.

-- (1) Retire the 12 orphan public functions left behind by Phase 2.B.6.
-- Every caller was moved to a per-tenant RPC routed through Netlify.
DROP FUNCTION IF EXISTS public._eq_intake_unwind_cards(uuid, uuid);
DROP FUNCTION IF EXISTS public._eq_intake_unwind_core(uuid, uuid);
DROP FUNCTION IF EXISTS public._eq_intake_unwind_field(uuid, uuid);
DROP FUNCTION IF EXISTS public._eq_intake_unwind_quotes(uuid, uuid);
DROP FUNCTION IF EXISTS public._eq_intake_unwind_service(uuid, uuid);
DROP FUNCTION IF EXISTS public.eq_browse_entity(text, integer, integer);
DROP FUNCTION IF EXISTS public.eq_cards_current_staff();
DROP FUNCTION IF EXISTS public.eq_cards_list_my_licences();
DROP FUNCTION IF EXISTS public.eq_cards_soft_delete_my_licence(uuid);
DROP FUNCTION IF EXISTS public.eq_cards_upsert_my_licence(jsonb);
DROP FUNCTION IF EXISTS public.eq_cards_upsert_my_profile(jsonb);
DROP FUNCTION IF EXISTS public.eq_tenant_dashboard_counts();

-- (2) Belt-and-braces empty schema so PostgREST's exposed-schemas
-- loader doesn't fail if `app_data` is still listed. Safe to drop in a
-- follow-up once the dashboard config has been corrected.
CREATE SCHEMA IF NOT EXISTS app_data;
GRANT USAGE ON SCHEMA app_data TO postgres, anon, authenticated, service_role;

-- Force PostgREST to rebuild its schema cache so the changes take
-- effect immediately rather than at next process restart.
NOTIFY pgrst, 'reload schema';
