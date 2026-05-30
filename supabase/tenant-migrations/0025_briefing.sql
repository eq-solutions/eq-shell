-- 0025_briefing.sql
-- Dashboard AI-briefing per-user cache + action log.
-- Re-homed into tenant-migrations so every tenant reproduces the surface.
--
-- Canonical corrections vs the live SKS copies:
--   * RLS scoped to app_metadata.tenant_id. The live policy was
--     `anon ... USING (true)` on the {public} role — the publishable key could
--     read/write every user's briefing. app_metadata.tenant_id is the established
--     canonical RLS claim (every other policy uses it; auth.uid() is not wired).
--   * tenant_id column added (the live tables are keyed per user_id with no
--     tenant_id). On SKS this becomes an ADD tenant_id + backfill + policy swap —
--     the gated Phase C reshape; here on EQ the tables are created empty/clean.
--
-- Idempotent + transactional. EQ (proving ground) first.

BEGIN;

CREATE TABLE IF NOT EXISTS app_data.briefing_cache (
  user_id      uuid        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  payload      jsonb       NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_data.briefing_actions (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid        NOT NULL,
  tenant_id     text        NOT NULL,
  action_title  text        NOT NULL,
  action_source text        NOT NULL,
  state         text        NOT NULL CHECK (state IN ('actioned','dismissed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS briefing_actions_user_recent
  ON app_data.briefing_actions (user_id, created_at DESC);

ALTER TABLE app_data.briefing_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.briefing_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_all_briefing_cache   ON app_data.briefing_cache;
DROP POLICY IF EXISTS "Tenant sees own briefing" ON app_data.briefing_cache;
CREATE POLICY "Tenant sees own briefing" ON app_data.briefing_cache
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));
DROP POLICY IF EXISTS "Service role full access on briefing" ON app_data.briefing_cache;
CREATE POLICY "Service role full access on briefing" ON app_data.briefing_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_all_briefing_actions          ON app_data.briefing_actions;
DROP POLICY IF EXISTS "Tenant sees own briefing actions"  ON app_data.briefing_actions;
CREATE POLICY "Tenant sees own briefing actions" ON app_data.briefing_actions
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id'));
DROP POLICY IF EXISTS "Service role full access on briefing actions" ON app_data.briefing_actions;
CREATE POLICY "Service role full access on briefing actions" ON app_data.briefing_actions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL  ON app_data.briefing_cache   FROM anon, authenticated;
REVOKE ALL  ON app_data.briefing_actions FROM anon, authenticated;
GRANT SELECT ON app_data.briefing_cache   TO authenticated;
GRANT SELECT ON app_data.briefing_actions TO authenticated;
GRANT ALL    ON app_data.briefing_cache   TO service_role;
GRANT ALL    ON app_data.briefing_actions TO service_role;

COMMIT;
