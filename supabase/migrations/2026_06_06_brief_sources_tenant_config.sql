-- Migration: per-tenant AI-brief source config
-- Adds brief_sources (jsonb) to shell_control.tenants so each tenant can narrow
-- which data sources feed its AI morning brief. ai-briefing reads this column
-- and treats NULL / absent keys as "all sources on" (DEFAULT_SOURCES in code).
--
-- Source flags (all default true when unset):
--   events        — app_data.canonical_events (cross-app activity log)
--   pipeline      — external pipeline-summary endpoint (pipeline_url/_api_key)
--   licences      — app_data.licences (expiring credentials)
--   asset_service — app_data.assets (overdue / upcoming service & calibration)
--   defects       — app_data.asset_defects (open defects)
--   incidents     — app_data.incidents (open safety incidents)
--
-- The function reads tolerantly, so deploying the code before this migration is
-- safe (it falls back to all-on). Only an explicit `false` disables a source.
--
-- Idempotent: IF NOT EXISTS guard.

ALTER TABLE shell_control.tenants
  ADD COLUMN IF NOT EXISTS brief_sources jsonb DEFAULT NULL;

COMMENT ON COLUMN shell_control.tenants.brief_sources IS
  'Optional per-tenant AI-brief source toggles, e.g. {"pipeline": false}. NULL or an absent key means the source is enabled. Keys: events, pipeline, licences, asset_service, defects, incidents.';
