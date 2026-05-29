-- Migration: per-tenant pipeline integration config
-- Adds pipeline_url + pipeline_api_key to shell_control.tenants so the
-- AI briefing can call an external pipeline-summary function on a per-tenant
-- basis rather than relying on global env vars.
--
-- Security note: pipeline_api_key is a bearer token shared between
-- eq-shell's ai-briefing function and the external pipeline-summary endpoint.
-- It is NOT a Supabase credential — treat it like an API key.
-- For higher sensitivity, move to an encrypted column or Vault.
--
-- Idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.

ALTER TABLE shell_control.tenants
  ADD COLUMN IF NOT EXISTS pipeline_url      text        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pipeline_api_key  text        DEFAULT NULL;

COMMENT ON COLUMN shell_control.tenants.pipeline_url     IS
  'Optional base URL of the external pipeline-summary function for this tenant. E.g. https://sks-nsw-labour.netlify.app. When set, ai-briefing fetches pipeline context from /.netlify/functions/pipeline-summary on this host.';

COMMENT ON COLUMN shell_control.tenants.pipeline_api_key IS
  'Bearer token for the pipeline-summary endpoint. Must match PIPELINE_API_KEY on the target Netlify site. Treat as a secret — do not expose to the browser.';
