-- 2026_06_01_security_groups.sql
-- Control-plane migration (jvknxcmbtrfnxfrwfimn shell_control schema).
--
-- Security groups — named bundles of extra perm keys assignable to users
-- beyond their role defaults. Enables limited customisation without full
-- custom role promotion (Limble-model: tiered defaults + targeted extras).
--
-- Lives on the control plane (not tenant data plane) so login +
-- verify-shell-session can query them via getServiceClient() without
-- needing the tenant routing / TENANT_ROUTING_MASTER_KEY path.
--
-- Applied 2026-06-01 via Supabase MCP (migration name: security_groups).

CREATE TABLE IF NOT EXISTS shell_control.security_groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES shell_control.tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  created_by  uuid        REFERENCES shell_control.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS security_groups_tenant ON shell_control.security_groups(tenant_id);

COMMENT ON TABLE shell_control.security_groups IS
  'Named bundles of extra permission keys assignable to users beyond their role defaults. Manager-only create/edit. Per-tenant.';

CREATE TABLE IF NOT EXISTS shell_control.security_group_perms (
  group_id    uuid        NOT NULL REFERENCES shell_control.security_groups(id) ON DELETE CASCADE,
  perm_key    text        NOT NULL,
  PRIMARY KEY (group_id, perm_key)
);

COMMENT ON TABLE shell_control.security_group_perms IS
  'Permission keys granted by a security group. perm_key must be a valid PermKey from @eq-solutions/roles.';

CREATE TABLE IF NOT EXISTS shell_control.user_security_groups (
  user_id     uuid        NOT NULL REFERENCES shell_control.users(id) ON DELETE CASCADE,
  group_id    uuid        NOT NULL REFERENCES shell_control.security_groups(id) ON DELETE CASCADE,
  assigned_by uuid        REFERENCES shell_control.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

CREATE INDEX IF NOT EXISTS user_security_groups_user ON shell_control.user_security_groups(user_id);
CREATE INDEX IF NOT EXISTS user_security_groups_group ON shell_control.user_security_groups(group_id);

COMMENT ON TABLE shell_control.user_security_groups IS
  'Maps users to their security groups. Used by login + verify-session to build extra_perms for the session token.';
