-- ============================================================
-- Migration 0074: Site credentials
--
-- Findings driving this (audit 2026-04-27):
--
--   - The Equinix 2026 Calendar Description column carries DALI computer
--     credentials, alarm panel codes, IPMI logins and similar — operational
--     creds the technician needs on the day to do their job. Royce confirmed
--     2026-04-27 these "should not be stripped on import" because they help
--     the tech attending site.
--
--   - Putting them in pm_calendar.tech_notes (free text, supervisor+ visible)
--     leaks them to every technician who can read pm_calendar — too wide.
--
--   - Putting them on customers / sites as columns is rigid (one set per site)
--     and doesn't capture multiple system creds per site (alarm panel, DALI,
--     IPMI, BMS, etc.).
--
-- Solution: a separate site_credentials table with stricter RLS — supervisor+
-- read/write, admin+ delete. Surfaced via the tech-briefing screen alongside
-- the calendar entry, so the technician can pull the right cred for the visit
-- without giving them blanket pm_calendar.tech_notes access.
--
-- Encryption: password_value stored as text. Supabase provides at-rest
-- encryption of the underlying storage. Column-level encryption via pgcrypto
-- can be added later if a customer demands it; not in scope for the closed
-- loop bootstrap.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_credentials (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_id      uuid        REFERENCES public.sites(id) ON DELETE CASCADE,
    -- site_id NULL = customer-level cred (e.g. portal login that covers all sites)
  -- Cred content
  system_name     text     NOT NULL,
    -- e.g. "DALI computer", "Honeywell alarm panel", "iDRAC IPMI", "BMS supervisor"
  username        text,
  password_value  text,
    -- Stored as text. Supabase encrypts at rest. Column-level encryption can
    -- be added later via pgcrypto if a customer requirement emerges.
  url             text,
    -- Optional URL / IP the cred targets
  notes           text,
    -- Free-text context: how to access, what to do if it doesn't work, etc.
  -- Standard tail
  is_active       boolean  NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX site_credentials_tenant_idx
  ON public.site_credentials(tenant_id);

CREATE INDEX site_credentials_customer_idx
  ON public.site_credentials(tenant_id, customer_id) WHERE is_active = true;

CREATE INDEX site_credentials_site_idx
  ON public.site_credentials(site_id) WHERE site_id IS NOT NULL AND is_active = true;

CREATE TRIGGER set_site_credentials_updated_at
  BEFORE UPDATE ON public.site_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.site_credentials ENABLE ROW LEVEL SECURITY;

-- Read: supervisor+ on the parent tenant.
-- Specifically excludes 'technician' and 'read_only' so creds don't leak via
-- general pm_calendar / site reads. Tech-briefing screen will surface the
-- cred via a SECURITY DEFINER helper (added later) to allow read on the day
-- of a scheduled visit only.
CREATE POLICY site_credentials_select ON public.site_credentials
  FOR SELECT USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY site_credentials_insert ON public.site_credentials
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY site_credentials_update ON public.site_credentials
  FOR UPDATE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

-- Delete tightened to admin+ — losing a cred matters, supervisor can soft-delete
-- via is_active=false instead.
CREATE POLICY site_credentials_delete ON public.site_credentials
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

COMMENT ON TABLE public.site_credentials IS
  'System credentials per customer / site (DALI, alarm, BMS, IPMI etc). Supervisor+ RLS for select/update; admin+ for delete. Replaces creds-in-Description-column pattern from existing 2026 EQX calendar.';

COMMENT ON COLUMN public.site_credentials.site_id IS
  'NULL = customer-level cred (covers all sites). Set = site-specific cred.';

COMMENT ON COLUMN public.site_credentials.password_value IS
  'Stored as text — Supabase encrypts at rest. Column-level encryption via pgcrypto can be added later if a customer requires it.';

COMMENT ON COLUMN public.site_credentials.system_name IS
  'What the credential is for (e.g. "DALI computer", "Honeywell alarm panel"). Free-text but should be consistent within a customer.';
