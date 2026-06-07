-- Per-tenant overrides to the default role permission matrix.
--
-- enabled=true  → grant this perm to the role even if roles.json default is false
-- enabled=false → deny this perm from the role even if roles.json default is true
--
-- Loaded at session-mint time (verify-shell-session + accept-invite) so the
-- entire set is baked into the session cookie — no per-request DB calls.

CREATE TABLE IF NOT EXISTS shell_control.tenant_role_overrides (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES shell_control.tenants(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('manager','supervisor','employee','apprentice','labour_hire')),
  perm_key    text        NOT NULL,
  enabled     boolean     NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES shell_control.users(id),
  UNIQUE (tenant_id, role, perm_key)
);

CREATE INDEX IF NOT EXISTS tenant_role_overrides_lookup_idx
  ON shell_control.tenant_role_overrides (tenant_id, role);
