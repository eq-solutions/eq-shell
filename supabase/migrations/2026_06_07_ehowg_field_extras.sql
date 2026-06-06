-- Migration: add SKS-specific Field tables to ehowg app_data schema
-- Applied to: ehowgjardagevnrluult (SKS EQ canonical data plane)
-- Purpose: prepare ehowg for the nspbmir → ehowg data migration
--
-- Adds: teams, team_members, timesheet_locks
-- These exist in nspbmir (nspbmirochztcjijmcrx) but were not in the original
-- per-tenant baseline. schedule and timesheets already exist in app_data.

-- teams — named groups for roster filtering (6 rows in nspbmir)
CREATE TABLE IF NOT EXISTS app_data.teams (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  nspbmir_id  bigint,                          -- original bigint ID, for migration dedup
  name        text        NOT NULL,
  color       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- team_members — people assigned to a team (48 rows in nspbmir)
CREATE TABLE IF NOT EXISTS app_data.team_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES app_data.teams(id) ON DELETE CASCADE,
  staff_id    uuid        NOT NULL REFERENCES app_data.staff(staff_id) ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, staff_id)
);

-- timesheet_locks — per-week accountant locks (0 rows in nspbmir, schema only needed)
CREATE TABLE IF NOT EXISTS app_data.timesheet_locks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  week_key    text        NOT NULL,            -- e.g. "02.06.26"
  locked_at   timestamptz NOT NULL DEFAULT now(),
  locked_by   text        NOT NULL,
  reason      text,
  UNIQUE (tenant_id, week_key)
);

-- RLS: tenant-scoped, same pattern as all other app_data tables
ALTER TABLE app_data.teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.team_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.timesheet_locks  ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (required for migration script + Netlify functions)
CREATE POLICY "service_role_bypass" ON app_data.teams
  USING (auth.role() = 'service_role');
CREATE POLICY "service_role_bypass" ON app_data.team_members
  USING (auth.role() = 'service_role');
CREATE POLICY "service_role_bypass" ON app_data.timesheet_locks
  USING (auth.role() = 'service_role');

-- Authenticated read/write scoped to caller's tenant
CREATE POLICY "tenant_read" ON app_data.teams
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );
CREATE POLICY "tenant_write" ON app_data.teams
  FOR ALL USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );

CREATE POLICY "tenant_read" ON app_data.team_members
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );
CREATE POLICY "tenant_write" ON app_data.team_members
  FOR ALL USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );

CREATE POLICY "tenant_read" ON app_data.timesheet_locks
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );
CREATE POLICY "tenant_write" ON app_data.timesheet_locks
  FOR ALL USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_teams_tenant         ON app_data.teams(tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team    ON app_data.team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_staff   ON app_data.team_members(staff_id);
CREATE INDEX IF NOT EXISTS idx_team_members_tenant  ON app_data.team_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tslocks_tenant_week  ON app_data.timesheet_locks(tenant_id, week_key);
