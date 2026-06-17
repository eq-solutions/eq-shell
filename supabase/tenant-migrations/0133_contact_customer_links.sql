-- Migration: 0133_contact_customer_links
-- Target:    Per-tenant data plane (app_data schema)
-- Purpose:   Allow one contact to be associated with multiple customers.
--            contacts.customer_id remains the "primary" customer.
--            contact_customer_links stores additional associations.
--
-- UI: Link / Unlink buttons appear on contact cards in /customers (EQ Shell).
--     Backend: crm-write.ts actions link_contact_customer / unlink_contact_customer.
--     crm-customers.ts detail action gracefully degrades if this migration is not yet applied.

CREATE TABLE IF NOT EXISTS app_data.contact_customer_links (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id  uuid        NOT NULL REFERENCES app_data.contacts(contact_id)  ON DELETE CASCADE,
  customer_id uuid        NOT NULL REFERENCES app_data.customers(customer_id) ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (contact_id, customer_id)
);

ALTER TABLE app_data.contact_customer_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON app_data.contact_customer_links
  USING (
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid = tenant_id
  );

REVOKE ALL ON app_data.contact_customer_links FROM PUBLIC;
REVOKE ALL ON app_data.contact_customer_links FROM anon;
GRANT SELECT, INSERT, DELETE ON app_data.contact_customer_links TO authenticated;
