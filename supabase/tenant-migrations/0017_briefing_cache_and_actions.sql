-- Tenant migration 0017: AI briefing cache + action state
--
-- briefing_cache: per-user brief cache keyed by user_id.
--   Generated fresh on login, cached for 10 minutes per user.
--   Invalidated on: manual regenerate, new canonical event (via webhook),
--   or when the user dismisses/actions an item.
--
-- briefing_actions: stores dismissed/actioned state per user per action.
--   Actions marked 'actioned' or 'dismissed' are excluded from the next
--   brief unless the underlying event re-fires.
--   Rows older than 48h are ignored (brief re-surfaces stale items).
--
-- RLS: tenant-scoped read/write (anon key is the app layer's credential).
-- Idempotent throughout.

-- ─── briefing_cache ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.briefing_cache (
  user_id      uuid        NOT NULL PRIMARY KEY,
  payload      jsonb       NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_data.briefing_cache IS
  'Per-user AI briefing cache. One row per user; upserted on generation, deleted on invalidation.';

ALTER TABLE app_data.briefing_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'app_data' AND tablename = 'briefing_cache' AND policyname = 'anon_all_briefing_cache'
  ) THEN
    CREATE POLICY anon_all_briefing_cache ON app_data.briefing_cache
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── briefing_actions ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_data.briefing_actions (
  id            bigserial   PRIMARY KEY,
  user_id       uuid        NOT NULL,
  action_title  text        NOT NULL,
  action_source text        NOT NULL,
  state         text        NOT NULL CHECK (state IN ('actioned', 'dismissed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS briefing_actions_user_recent
  ON app_data.briefing_actions (user_id, created_at DESC);

COMMENT ON TABLE app_data.briefing_actions IS
  'User-level record of actioned or dismissed AI briefing actions. Rows older than 48h are ignored by the briefing function.';

ALTER TABLE app_data.briefing_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'app_data' AND tablename = 'briefing_actions' AND policyname = 'anon_all_briefing_actions'
  ) THEN
    CREATE POLICY anon_all_briefing_actions ON app_data.briefing_actions
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
