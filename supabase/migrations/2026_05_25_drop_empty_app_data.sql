-- Migration: 2026_05_25_drop_empty_app_data
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Final cleanup after Phase 2.B.7 + the 2026-05-24 hotfix chain.
--
-- Follow-up to:
--   2026_05_24c — DROP SCHEMA app_data CASCADE (removed 43 tables)
--   2026_05_24d — orphan-function cleanup + recreated empty app_data as
--                 a belt-and-braces no-op while PostgREST still listed
--                 app_data in its exposed-schemas config.
--
-- Task #93 done (2026-05-25): Royce removed app_data from the project's
-- exposed-schemas list in the Supabase dashboard (Settings -> API). The
-- empty schema is no longer load-bearing; PostgREST will not try to
-- introspect it on schema-cache reload.
--
-- Pre-flight verified via MCP at 2026-05-25 04:38 UTC:
--   SELECT count(*) FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--     WHERE n.nspname = 'app_data';
--   -> 0 objects
--
-- Applied via MCP at 2026-05-25 04:39 UTC. This migration is captured
-- here for source-of-truth alignment; it is a no-op on next deploy.

DROP SCHEMA IF EXISTS app_data;

-- Force PostgREST to rebuild its schema cache so the change takes effect
-- immediately rather than at next process restart.
NOTIFY pgrst, 'reload schema';
