-- PIN reset tokens table + correct service_role grants.
-- The table was created live before this migration existed; this file
-- records the DDL so a fresh provision gets the right structure and grants.
-- The GRANT was applied as a hotfix 2026-06-08: table was born without
-- service_role privileges (default-privilege lockdown 2026-06-07), which
-- caused PostgREST inserts to fail silently while direct SQL worked fine.

CREATE TABLE IF NOT EXISTS shell_control.pin_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES shell_control.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid REFERENCES shell_control.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Service-role-only: no anon/authenticated path.
-- RLS is ON with no policies (blocks all row-level access via JWT).
-- service_role bypasses RLS, so these grants are the access gate.
ALTER TABLE shell_control.pin_reset_tokens ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON shell_control.pin_reset_tokens TO service_role;
