-- Migration: 0010_intake_core_rpc
-- Target:    Per-tenant data plane
-- Purpose:   Core intake commit RPC (customers, sites, contacts — the
--            SimPRO bundle flow). Fourth module of the staged intake-writer
--            migration (Phase 2.B.6 in ARCHITECTURE-V2.md, after 0005
--            cards + 0008 service + 0009 quotes).
--
--            Three tables:
--              customers (PK customer_id)         — root of the bundle
--              sites     (PK site_id,    FK customer_id)
--              contacts  (PK contact_id, FK customer_id)
--
--            Adds a THIRD return column `committed_keys` not present in
--            the other module RPCs. For the 'customers' batch it carries
--            { external_id: customer_id, ... } so the browser-side
--            commit-canonical can resolve site/contact FKs without a
--            second round-trip to read back the customers table.
--            (commit-canonical's original buildCustomerIdMap() did that
--            read directly against shared eq-canonical — no longer
--            possible after this cutover because the browser doesn't
--            have a direct tenant-DB client.)
--
--            For 'sites' / 'contacts' batches, committed_keys is '{}'::jsonb.
--
--            Reuses public._eq_intake_apply_metadata from 0005.

CREATE OR REPLACE FUNCTION public.eq_intake_commit_batch_core(
  p_intake_id        uuid,
  p_tenant_id        uuid,
  p_table            text,
  p_rows             jsonb,
  p_source_sig       text,
  p_schema_version   text,
  p_import_mode      text DEFAULT 'append',
  p_confirm_replace  boolean DEFAULT false
)
RETURNS TABLE(committed_count integer, committed_ids uuid[], committed_keys jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_count int := 0;
  v_ids   uuid[] := ARRAY[]::uuid[];
  v_keys  jsonb  := '{}'::jsonb;
  v_row   jsonb;
  v_id    uuid;
  v_ext   text;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id is required'; END IF;
  IF p_intake_id IS NULL THEN RAISE EXCEPTION 'p_intake_id is required'; END IF;
  IF p_table NOT IN ('customers','sites','contacts') THEN
    RAISE EXCEPTION 'table % not core-domain (only customers, sites, contacts)', p_table;
  END IF;
  IF p_import_mode NOT IN ('append', 'upsert', 'replace') THEN
    RAISE EXCEPTION 'invalid import_mode: % (expected append | upsert | replace)', p_import_mode;
  END IF;

  IF p_import_mode = 'replace' THEN
    IF NOT p_confirm_replace THEN RAISE EXCEPTION 'replace requires p_confirm_replace=true'; END IF;
    EXECUTE format('DELETE FROM app_data.%I WHERE tenant_id = $1 AND imported_from = $2', p_table)
      USING p_tenant_id, p_source_sig;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_row := _eq_intake_apply_metadata(v_row, p_tenant_id, p_intake_id, p_source_sig, p_schema_version);

    IF p_table = 'customers' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.customers SELECT * FROM jsonb_populate_record(NULL::app_data.customers, v_row)
          ON CONFLICT (customer_id) DO UPDATE SET
            external_id=EXCLUDED.external_id, type=EXCLUDED.type, company_name=EXCLUDED.company_name,
            first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, salutation=EXCLUDED.salutation,
            abn=EXCLUDED.abn, acn=EXCLUDED.acn,
            street_address=EXCLUDED.street_address, suburb=EXCLUDED.suburb, state=EXCLUDED.state,
            postcode=EXCLUDED.postcode, country=EXCLUDED.country,
            postal_address=EXCLUDED.postal_address, postal_suburb=EXCLUDED.postal_suburb,
            postal_state=EXCLUDED.postal_state, postal_postcode=EXCLUDED.postal_postcode, postal_country=EXCLUDED.postal_country,
            primary_phone=EXCLUDED.primary_phone, mobile_phone=EXCLUDED.mobile_phone, alt_phone=EXCLUDED.alt_phone,
            fax=EXCLUDED.fax, email=EXCLUDED.email, website=EXCLUDED.website,
            customer_group=EXCLUDED.customer_group, customer_profile=EXCLUDED.customer_profile,
            account_manager=EXCLUDED.account_manager, currency=EXCLUDED.currency,
            default_quote_method=EXCLUDED.default_quote_method, default_invoice_method=EXCLUDED.default_invoice_method,
            default_job_method=EXCLUDED.default_job_method, referred_by=EXCLUDED.referred_by,
            notes=EXCLUDED.notes, active=EXCLUDED.active, created_date=EXCLUDED.created_date,
            imported_at=EXCLUDED.imported_at, imported_from=EXCLUDED.imported_from, intake_id=EXCLUDED.intake_id, schema_version=EXCLUDED.schema_version
          RETURNING customer_id INTO v_id;
      ELSE
        INSERT INTO app_data.customers SELECT * FROM jsonb_populate_record(NULL::app_data.customers, v_row) RETURNING customer_id INTO v_id;
      END IF;
      -- Collect the FK map entry. external_id is the SimPRO Customer ID.
      v_ext := v_row ->> 'external_id';
      IF v_id IS NOT NULL AND v_ext IS NOT NULL AND v_ext <> '' THEN
        v_keys := v_keys || jsonb_build_object(v_ext, v_id::text);
      END IF;

    ELSIF p_table = 'sites' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.sites SELECT * FROM jsonb_populate_record(NULL::app_data.sites, v_row)
          ON CONFLICT (site_id) DO UPDATE SET
            external_id=EXCLUDED.external_id, customer_id=EXCLUDED.customer_id, external_customer_id=EXCLUDED.external_customer_id,
            name=EXCLUDED.name, code=EXCLUDED.code, client_name=EXCLUDED.client_name, site_type=EXCLUDED.site_type,
            address_line_1=EXCLUDED.address_line_1, address_line_2=EXCLUDED.address_line_2,
            suburb=EXCLUDED.suburb, state=EXCLUDED.state, postcode=EXCLUDED.postcode, country=EXCLUDED.country,
            latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
            site_contact_name=EXCLUDED.site_contact_name, site_contact_phone=EXCLUDED.site_contact_phone, site_contact_email=EXCLUDED.site_contact_email,
            induction_required=EXCLUDED.induction_required, induction_url=EXCLUDED.induction_url,
            active=EXCLUDED.active, notes=EXCLUDED.notes,
            imported_at=EXCLUDED.imported_at, imported_from=EXCLUDED.imported_from, intake_id=EXCLUDED.intake_id, schema_version=EXCLUDED.schema_version,
            track_hours=EXCLUDED.track_hours, budget_hours=EXCLUDED.budget_hours, slug=EXCLUDED.slug
          RETURNING site_id INTO v_id;
      ELSE
        INSERT INTO app_data.sites SELECT * FROM jsonb_populate_record(NULL::app_data.sites, v_row) RETURNING site_id INTO v_id;
      END IF;

    ELSIF p_table = 'contacts' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.contacts SELECT * FROM jsonb_populate_record(NULL::app_data.contacts, v_row)
          ON CONFLICT (contact_id) DO UPDATE SET
            customer_id=EXCLUDED.customer_id, external_id=EXCLUDED.external_id, external_customer_id=EXCLUDED.external_customer_id,
            company_name=EXCLUDED.company_name, salutation=EXCLUDED.salutation, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
            email=EXCLUDED.email, work_phone=EXCLUDED.work_phone, mobile_phone=EXCLUDED.mobile_phone, fax=EXCLUDED.fax,
            position=EXCLUDED.position, department=EXCLUDED.department, notes=EXCLUDED.notes,
            is_default_quote_contact=EXCLUDED.is_default_quote_contact, is_default_job_contact=EXCLUDED.is_default_job_contact,
            is_default_invoice_contact=EXCLUDED.is_default_invoice_contact, is_default_statement_contact=EXCLUDED.is_default_statement_contact,
            active=EXCLUDED.active,
            imported_at=EXCLUDED.imported_at, imported_from=EXCLUDED.imported_from, intake_id=EXCLUDED.intake_id, schema_version=EXCLUDED.schema_version
          RETURNING contact_id INTO v_id;
      ELSE
        INSERT INTO app_data.contacts SELECT * FROM jsonb_populate_record(NULL::app_data.contacts, v_row) RETURNING contact_id INTO v_id;
      END IF;
    END IF;

    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      v_ids   := array_append(v_ids, v_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_count, v_ids, v_keys;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_intake_commit_batch_core(uuid, uuid, text, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_intake_commit_batch_core(uuid, uuid, text, jsonb, text, text, text, boolean) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0010_intake_core_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
