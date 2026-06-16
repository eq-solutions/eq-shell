-- Migration: 0128_sks_contact_links_constrain
-- SUPERSEDED / NO-OP
-- sks_contact_links is a VIEW over app_data.contact_customer_links — ALTER TABLE
-- on a view fails (PG error 42809). The base table sks_quotes_contact_links already
-- has PRIMARY KEY (contact_id, customer_id). The eq-quotes upsert was redirected to
-- sks_quotes_contact_links in the app code (PR eq-solutions/eq-quotes#39).
-- Nothing to do here.

BEGIN;
DO $$ BEGIN
  RAISE NOTICE '0128: no-op — sks_quotes_contact_links already has PK (contact_id, customer_id)';
END $$;
COMMIT;
