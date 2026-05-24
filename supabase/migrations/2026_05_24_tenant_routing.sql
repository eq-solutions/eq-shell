-- Migration: 2026_05_24_tenant_routing
-- Purpose: Per-tenant data plane routing. Holds the URL + encrypted service-role
--          key for each tenant's dedicated Supabase project (their app_data home).
-- Architecture: docs/ARCHITECTURE-V2.md "tenant_routing — the key new piece"
--
-- This table is the single source of truth for "which Supabase project holds
-- tenant X's operational data?" Shell Netlify functions read this table to
-- route canonical-api requests to the right tenant DB.
--
-- Security model:
--   * service_role_key is stored AES-256-GCM encrypted (ciphertext + iv + tag)
--   * Master key (TENANT_ROUTING_MASTER_KEY) lives only in Netlify env
--   * RLS enabled with NO policies — only service_role can read
--   * Browser code MUST NOT read this table (no anon-key access path)
--
-- Lifecycle: 'provisioning' → 'active' (normal) | 'suspended' | 'archived'

BEGIN;

-- Status enum for the tenant lifecycle. Limited to four states intentionally:
--   provisioning: project created but not yet smoke-tested
--   active:       serving traffic
--   suspended:    Shell returns 402; data preserved (billing dispute, etc.)
--   archived:     data exported to customer; project paused; 90-day retention
CREATE TYPE shell_control.tenant_routing_status AS ENUM (
  'provisioning',
  'active',
  'suspended',
  'archived'
);

CREATE TABLE shell_control.tenant_routing (
  tenant_id uuid PRIMARY KEY
    REFERENCES shell_control.tenants(id)
    ON DELETE RESTRICT,                  -- never cascade-delete a routing row
                                          -- (tenant deletion is a multi-step process)

  -- Connection info (non-secret)
  supabase_url            text NOT NULL,  -- e.g. https://xyz.supabase.co
  supabase_project_ref    text NOT NULL,  -- Supabase project reference (xyz)
  supabase_anon_key       text NOT NULL,  -- anon key (browser-safe; RLS gates access)
  region                  text NOT NULL,  -- e.g. ap-southeast-2

  -- Service-role key, AES-256-GCM encrypted
  -- All three fields are required to decrypt. Tampering invalidates auth tag.
  service_role_key_ciphertext text NOT NULL,
  service_role_key_iv         text NOT NULL,   -- 96-bit IV, hex-encoded
  service_role_key_tag        text NOT NULL,   -- 128-bit auth tag, hex-encoded

  -- Lifecycle
  status              shell_control.tenant_routing_status NOT NULL
                                                          DEFAULT 'provisioning',
  provisioned_at      timestamptz NOT NULL DEFAULT now(),
  status_changed_at   timestamptz NOT NULL DEFAULT now(),

  -- Operational notes (free-text; not parsed)
  notes text,

  -- Constraints
  CONSTRAINT tenant_routing_supabase_url_format
    CHECK (supabase_url LIKE 'https://%.supabase.co' OR supabase_url LIKE 'http://localhost%'),
  CONSTRAINT tenant_routing_project_ref_format
    CHECK (supabase_project_ref ~ '^[a-z0-9]+$' AND length(supabase_project_ref) BETWEEN 10 AND 32),
  CONSTRAINT tenant_routing_region_known
    CHECK (region IN (
      'ap-southeast-2', 'ap-southeast-1', 'ap-south-1',
      'us-east-1', 'us-west-1',
      'eu-west-1', 'eu-west-2', 'eu-central-1'
    ))
);

-- Index by status for the common "list active tenants" query
-- (used by the schema migration runner and tenant-list admin views)
CREATE INDEX tenant_routing_status_idx
  ON shell_control.tenant_routing (status)
  WHERE status = 'active';

-- Service-role needs explicit grants on shell_control (Supabase only
-- auto-grants on public schema). Without these, even service_role gets
-- "permission denied for table tenant_routing".
GRANT USAGE ON SCHEMA shell_control TO service_role;
GRANT USAGE ON TYPE  shell_control.tenant_routing_status TO service_role;
GRANT ALL   ON       shell_control.tenant_routing        TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA shell_control GRANT ALL ON TABLES TO service_role;

-- Lock down: RLS enabled, NO policies = only service_role can touch it.
-- Service role bypasses RLS by design. Any authenticated user role
-- (anon, authenticated) sees an empty table.
ALTER TABLE shell_control.tenant_routing ENABLE ROW LEVEL SECURITY;

-- Trigger to keep status_changed_at honest when status flips
CREATE OR REPLACE FUNCTION shell_control.tenant_routing_touch_status_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_routing_touch_status_changed_trg
  BEFORE UPDATE ON shell_control.tenant_routing
  FOR EACH ROW
  EXECUTE FUNCTION shell_control.tenant_routing_touch_status_changed();

-- Comment for anyone running \d+ on the table
COMMENT ON TABLE shell_control.tenant_routing IS
  'Per-tenant Supabase data-plane routing. Service-role key encrypted with AES-256-GCM using TENANT_ROUTING_MASTER_KEY (Netlify env). RLS enabled, no policies — service_role only. See docs/ARCHITECTURE-V2.md.';

COMMIT;
