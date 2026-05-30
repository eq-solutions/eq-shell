-- 0028_contact_customer_links.sql
-- Canonical contact↔customer link table + pin the touch_updated_at helper.
--
-- WHY: SKS (ehowg) has app_data.contact_customer_links (the contacts↔customers
-- many-to-many fed by the Quotes contacts flow); EQ (zaapmf) lacked it, so a
-- fresh tenant provisioned from tenant-migrations/ alone would NOT reproduce the
-- full canonical surface. Capture it forward-only: additive, idempotent, and
-- hardened from the start (RLS on app_metadata; writes service_role-only — the
-- browser reaches it through canonical-api / intake, never directly).
--
-- Faithful to the live SKS shape: PK link_id, UNIQUE (contact_id, customer_id),
-- FKs to contacts/customers ON DELETE CASCADE, tenant_id + role + active.
--
-- Also pins app_data.touch_updated_at's search_path (advisor lint 0011) — it was
-- created without SET search_path; pinning is a no-op for behaviour, reversible.

BEGIN;

CREATE TABLE IF NOT EXISTS app_data.contact_customer_links (
  link_id     uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  contact_id  uuid        NOT NULL,
  customer_id uuid        NOT NULL,
  role        text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_customer_links_pkey PRIMARY KEY (link_id),
  CONSTRAINT contact_customer_links_contact_id_customer_id_key UNIQUE (contact_id, customer_id),
  CONSTRAINT contact_customer_links_contact_fk  FOREIGN KEY (contact_id)
    REFERENCES app_data.contacts(contact_id)   ON DELETE CASCADE,
  CONSTRAINT contact_customer_links_customer_fk FOREIGN KEY (customer_id)
    REFERENCES app_data.customers(customer_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ccl_contact  ON app_data.contact_customer_links (contact_id);
CREATE INDEX IF NOT EXISTS idx_ccl_customer ON app_data.contact_customer_links (customer_id);
CREATE INDEX IF NOT EXISTS idx_ccl_tenant   ON app_data.contact_customer_links (tenant_id);

ALTER TABLE app_data.contact_customer_links ENABLE ROW LEVEL SECURITY;

-- Reads scoped to the caller's tenant via app_metadata (NOT user_metadata).
DROP POLICY IF EXISTS ccl_tenant_read ON app_data.contact_customer_links;
CREATE POLICY ccl_tenant_read ON app_data.contact_customer_links
  FOR SELECT TO authenticated
  USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

-- Writes are service_role only (canonical-api / intake); browser never writes directly.
REVOKE ALL    ON app_data.contact_customer_links FROM anon, authenticated;
GRANT  SELECT ON app_data.contact_customer_links TO   authenticated;
GRANT  ALL    ON app_data.contact_customer_links TO   service_role;

-- Advisor 0011 — pin the trigger helper's search_path.
ALTER FUNCTION app_data.touch_updated_at() SET search_path = 'app_data', 'public', 'extensions';

COMMIT;
