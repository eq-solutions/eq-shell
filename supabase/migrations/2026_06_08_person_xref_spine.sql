-- 2026_06_08_person_xref_spine.sql
-- Control-plane (jvkn shell_control) migration.
--
-- Creates the golden-record person spine that resolves cross-tenant worker
-- identity for the labour-hire case. Per ADR-002 §2:
--   - "Who is this human" lives here (cross-tenant opaque pointer)
--   - "What they did for tenant X" stays tenant-scoped, never crosses
--
-- Tables:
--   shell_control.persons      — one row per unique human being
--   shell_control.person_xref  — maps (tenant, local record) → person_id
--
-- Design principles:
--   - Deterministic match keys (email, phone, abn) — no fuzzy auto-merge
--   - Merges are soft (provenance preserved in person_xref.merged_into)
--   - No PII centralised beyond match keys; name is for display only
--   - Service-role write path; platform_admin read path
-- ─────────────────────────────────────────────────────────────────────

-- ── persons ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shell_control.persons (
  person_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Display (denormalised from the most-recently-seen source record)
  display_name text,

  -- Deterministic match keys — all lowercased/normalised on write
  -- NULL means "not yet known"; we never match on NULL
  email        text,
  phone        text,         -- E.164 recommended, not enforced here
  abn          text,         -- digits only (spaces stripped)

  -- Soft-merge: when two persons are collapsed, the loser points here
  -- and all xref rows are re-pointed to the winner. The loser row is
  -- kept for audit / reversal.
  merged_into  uuid REFERENCES shell_control.persons (person_id),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Unique partial indexes on match keys (NULL excluded so unknown ≠ collision)
CREATE UNIQUE INDEX IF NOT EXISTS persons_email_uniq
  ON shell_control.persons (lower(email))
  WHERE email IS NOT NULL AND merged_into IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS persons_abn_uniq
  ON shell_control.persons (abn)
  WHERE abn IS NOT NULL AND merged_into IS NULL;

-- phone is intentionally NOT unique — shared numbers (reception, family) are common

COMMENT ON TABLE shell_control.persons IS
  'Golden-record person spine. One row per unique human being across all tenants. '
  'Used for cross-tenant worker identity in the labour-hire arc. '
  'Write path: service_role only. Read: platform_admin. '
  'See ADR-002 §2.';

-- ── person_xref ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shell_control.person_xref (
  xref_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  person_id    uuid        NOT NULL REFERENCES shell_control.persons (person_id),

  -- Which tenant owns the local record
  tenant_id    uuid        NOT NULL,  -- references shell_control.tenants implicitly

  -- The local record pointer — table name + UUID so we can xref across
  -- workers, staff, users without a separate join table per entity
  local_table  text        NOT NULL,  -- e.g. 'workers', 'app_data.staff', 'users'
  local_id     uuid        NOT NULL,

  -- Source of the link (etl | cards | manual | shell)
  source       text        NOT NULL DEFAULT 'etl',

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate xref for the same (tenant, table, local_id)
  UNIQUE (tenant_id, local_table, local_id)
);

CREATE INDEX IF NOT EXISTS person_xref_person_id_idx
  ON shell_control.person_xref (person_id);

CREATE INDEX IF NOT EXISTS person_xref_tenant_id_idx
  ON shell_control.person_xref (tenant_id);

COMMENT ON TABLE shell_control.person_xref IS
  'Cross-reference: (tenant, local_table, local_id) → person_id. '
  'Enables identity resolution across tenants without sharing PII. '
  'The local record (hours, licences, payroll) stays tenant-scoped; '
  'only this opaque pointer crosses. See ADR-002 §2.';

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE shell_control.persons    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shell_control.person_xref ENABLE ROW LEVEL SECURITY;

-- All writes: service_role only (no policy = no browser path)
-- Platform admin read: via JWT claim is_platform_admin
CREATE POLICY persons_platform_admin_read
  ON shell_control.persons
  FOR SELECT
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean IS TRUE
  );

CREATE POLICY person_xref_platform_admin_read
  ON shell_control.person_xref
  FOR SELECT
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean IS TRUE
  );

-- ── default privileges (born closed) ──────────────────────────────────
-- Explicit REVOKE — belt-and-suspenders given the 2026-06-07 lockdown
-- already removed anon/authenticated from the DEFAULT PRIVILEGES, but
-- an explicit per-table revoke ensures correctness even if defaults drift.
REVOKE ALL ON shell_control.persons     FROM anon, authenticated;
REVOKE ALL ON shell_control.person_xref FROM anon, authenticated;
GRANT  ALL ON shell_control.persons     TO   service_role;
GRANT  ALL ON shell_control.person_xref TO   service_role;
