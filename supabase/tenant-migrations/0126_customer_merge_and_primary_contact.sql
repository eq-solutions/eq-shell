-- Migration: 0126_customer_merge_and_primary_contact
-- Target:    Per-tenant data plane
-- Purpose:   Two EQ Ops "By Client" tools.
--   1. eq_merge_customers(p_keep, p_dupe) — fold a duplicate client into a
--      keeper: re-point every child row (quotes, contacts, sites, contact links,
--      group members, contract scopes, tenders, jobs) from the dupe to the
--      keeper, then ARCHIVE the dupe (active=false — recoverable). Callable,
--      tenant-scoped version of the one-time 0097 dedup logic. Both customers
--      must belong to the caller's tenant. Child re-points match on customer_id
--      only (the PK is globally unique and both ids are tenant-validated above),
--      which also avoids assuming every child table carries tenant_id.
--   2. eq_set_default_contact(p_contact_id) — mark one contact as the default
--      quote contact for its customer, clearing the flag on that customer's other
--      contacts. Tenant-scoped.

CREATE OR REPLACE FUNCTION public.eq_merge_customers(p_keep_customer_id uuid, p_dupe_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_keep_customer_id = p_dupe_customer_id THEN
    RAISE EXCEPTION 'cannot merge a client into itself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_data.customers WHERE customer_id = p_keep_customer_id AND tenant_id = v_tenant_id)
     OR NOT EXISTS (SELECT 1 FROM app_data.customers WHERE customer_id = p_dupe_customer_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'client not found or access denied';
  END IF;

  UPDATE app_data.quote    SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;
  UPDATE app_data.contacts SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app_data' AND table_name='sites' AND column_name='customer_id') THEN
    UPDATE app_data.sites SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='app_data' AND table_name='contact_customer_links') THEN
    DELETE FROM app_data.contact_customer_links lnk
     WHERE lnk.customer_id = p_dupe_customer_id
       AND EXISTS (SELECT 1 FROM app_data.contact_customer_links k2
                    WHERE k2.contact_id = lnk.contact_id AND k2.customer_id = p_keep_customer_id);
    UPDATE app_data.contact_customer_links SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='app_data' AND table_name='client_group_members') THEN
    DELETE FROM app_data.client_group_members m
     WHERE m.customer_id = p_dupe_customer_id
       AND EXISTS (SELECT 1 FROM app_data.client_group_members m2
                    WHERE m2.group_id = m.group_id AND m2.customer_id = p_keep_customer_id);
    UPDATE app_data.client_group_members SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app_data' AND table_name='contract_scopes' AND column_name='customer_id') THEN
    UPDATE app_data.contract_scopes SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app_data' AND table_name='tenders' AND column_name='customer_id') THEN
    UPDATE app_data.tenders SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app_data' AND table_name='jobs' AND column_name='customer_id') THEN
    UPDATE app_data.jobs SET customer_id = p_keep_customer_id WHERE customer_id = p_dupe_customer_id;
  END IF;

  UPDATE app_data.customers SET active = false, updated_at = now()
   WHERE customer_id = p_dupe_customer_id AND tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_merge_customers(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_merge_customers(uuid, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.eq_set_default_contact(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid; v_customer_id uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  SELECT customer_id INTO v_customer_id FROM app_data.contacts
   WHERE contact_id = p_contact_id AND tenant_id = v_tenant_id;
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'contact not found or access denied'; END IF;
  UPDATE app_data.contacts
     SET is_default_quote_contact = (contact_id = p_contact_id), updated_at = now()
   WHERE customer_id = v_customer_id AND tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_default_contact(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_set_default_contact(uuid) TO authenticated;
