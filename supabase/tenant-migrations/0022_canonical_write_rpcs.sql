-- Migration: 0022_canonical_write_rpcs
-- Target:    Per-tenant data plane (every tenant Supabase project)
-- Purpose:   Codify the customer/site/contact management RPCs that were applied
--            OUT OF BAND to sks-canonical (the 3-digit "021/022/023" series).
--            These power the Shell entity-browser (archive/unarchive/delete/upsert)
--            + Quotes' canonical customer/contact writes.
--
-- Security model is already correct on SKS and reproduced verbatim:
--   * SECURITY DEFINER, search_path pinned, EXECUTE = authenticated + service_role
--     (anon revoked). Safe because each derives tenant_id from
--     auth.jwt()->app_metadata->tenant_id — NOT from a parameter — so a caller
--     cannot reach another tenant's rows. (Contrast 0021's PPM fns, which took a
--     tenant param and were therefore locked to service_role.)
--
-- Two things the bodies require that the baseline doesn't provide:
--   * UNIQUE partial index on (tenant_id, external_id) for the upsert ON CONFLICT
--     (baseline 0001 created only a NON-unique index) — added below.
--
-- DELIBERATELY EXCLUDED: eq_list_module_entities. Its body reads
--   shell_control.eq_schema_registry, which is a CONTROL-PLANE schema not present
--   on per-tenant data planes (zaapmf has no shell_control). It is a control-plane
--   function and must live on the shared project (jvkn), where the registry is.
--   The Shell's DomainLanding call to it should target the control plane, not the
--   tenant plane. Tracked as a Track-A control-plane reconciliation item.
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS) + forward-only.

BEGIN;

-- Unique partial indexes the upsert ON CONFLICT clauses depend on.
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_external_id_uidx
  ON app_data.customers (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_external_id_uidx
  ON app_data.contacts (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sites_tenant_external_id_uidx
  ON app_data.sites (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- ── archive / unarchive / delete ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_archive_contact(p_contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
BEGIN
  UPDATE app_data.contacts
  SET    active     = false,
         updated_at = now()
  WHERE  contact_id = p_contact_id
    AND  tenant_id  = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_archive_customer(p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
BEGIN
  UPDATE app_data.customers
  SET    active      = false,
         updated_at  = now()
  WHERE  customer_id = p_customer_id
    AND  tenant_id   = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_archive_site(p_site_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
begin
  update app_data.sites
  set active     = false,
      updated_at = now()
  where site_id  = p_site_id
    and tenant_id = (
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.eq_delete_contact(p_contact_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_count int;
BEGIN
  DELETE FROM app_data.contacts
  WHERE  contact_id = p_contact_id
    AND  tenant_id  = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_delete_customer(p_customer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_count int;
BEGIN
  DELETE FROM app_data.customers
  WHERE  customer_id = p_customer_id
    AND  tenant_id   = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_delete_site(p_site_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
begin
  delete from app_data.sites
  where site_id  = p_site_id
    and tenant_id = (
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.eq_unarchive_contact(p_contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
BEGIN
  UPDATE app_data.contacts
  SET    active     = true,
         updated_at = now()
  WHERE  contact_id = p_contact_id
    AND  tenant_id  = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_unarchive_customer(p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
BEGIN
  UPDATE app_data.customers
  SET    active      = true,
         updated_at  = now()
  WHERE  customer_id = p_customer_id
    AND  tenant_id   = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_unarchive_site(p_site_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
begin
  update app_data.sites
  set active     = true,
      updated_at = now()
  where site_id  = p_site_id
    and tenant_id = (
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    );
end;
$function$;

-- ── list (read) ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_list_sites(p_search text DEFAULT NULL::text, p_show_archived boolean DEFAULT false)
 RETURNS TABLE(site_id uuid, name character varying, client_name text, suburb text, state text, external_id character varying, imported_from text, active boolean, customer_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
  select
    s.site_id,
    s.name,
    s.client_name,
    s.suburb,
    s.state,
    s.external_id,
    s.imported_from,
    s.active,
    s.customer_id
  from app_data.sites s
  where s.tenant_id = (
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  )
    and (p_show_archived or s.active = true)
    and (
      p_search is null
      or s.name ilike '%' || p_search || '%'
      or s.client_name ilike '%' || p_search || '%'
      or s.suburb ilike '%' || p_search || '%'
      or s.external_id ilike '%' || p_search || '%'
    )
  order by s.name;
$function$;

-- ── upsert ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_upsert_contact(p_external_id character varying, p_customer_id uuid DEFAULT NULL::uuid, p_external_customer_id character varying DEFAULT NULL::character varying, p_company_name character varying DEFAULT NULL::character varying, p_salutation character varying DEFAULT NULL::character varying, p_first_name character varying DEFAULT NULL::character varying, p_last_name character varying DEFAULT NULL::character varying, p_email character varying DEFAULT NULL::character varying, p_work_phone character varying DEFAULT NULL::character varying, p_mobile_phone character varying DEFAULT NULL::character varying, p_position character varying DEFAULT NULL::character varying, p_department character varying DEFAULT NULL::character varying, p_is_default_quote_contact boolean DEFAULT NULL::boolean, p_is_default_job_contact boolean DEFAULT NULL::boolean, p_is_default_invoice_contact boolean DEFAULT NULL::boolean, p_is_default_statement_contact boolean DEFAULT NULL::boolean, p_active boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id        uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  INSERT INTO app_data.contacts (
    contact_id,                    tenant_id,               external_id,
    customer_id,                   external_customer_id,
    company_name,                  salutation,
    first_name,                    last_name,
    email,                         work_phone,              mobile_phone,
    position,                      department,
    is_default_quote_contact,      is_default_job_contact,
    is_default_invoice_contact,    is_default_statement_contact,
    active
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_external_id,
    p_customer_id, p_external_customer_id,
    p_company_name, p_salutation,
    p_first_name, p_last_name,
    p_email, p_work_phone, p_mobile_phone,
    p_position, p_department,
    COALESCE(p_is_default_quote_contact,     false),
    COALESCE(p_is_default_job_contact,       false),
    COALESCE(p_is_default_invoice_contact,   false),
    COALESCE(p_is_default_statement_contact, false),
    COALESCE(p_active, true)
  )
  ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    customer_id                  = COALESCE(EXCLUDED.customer_id,                  contacts.customer_id),
    external_customer_id         = COALESCE(EXCLUDED.external_customer_id,         contacts.external_customer_id),
    company_name                 = COALESCE(EXCLUDED.company_name,                 contacts.company_name),
    salutation                   = COALESCE(EXCLUDED.salutation,                   contacts.salutation),
    first_name                   = COALESCE(EXCLUDED.first_name,                   contacts.first_name),
    last_name                    = COALESCE(EXCLUDED.last_name,                    contacts.last_name),
    email                        = COALESCE(EXCLUDED.email,                        contacts.email),
    work_phone                   = COALESCE(EXCLUDED.work_phone,                   contacts.work_phone),
    mobile_phone                 = COALESCE(EXCLUDED.mobile_phone,                 contacts.mobile_phone),
    position                     = COALESCE(EXCLUDED.position,                     contacts.position),
    department                   = COALESCE(EXCLUDED.department,                   contacts.department),
    is_default_quote_contact     = COALESCE(EXCLUDED.is_default_quote_contact,     contacts.is_default_quote_contact),
    is_default_job_contact       = COALESCE(EXCLUDED.is_default_job_contact,       contacts.is_default_job_contact),
    is_default_invoice_contact   = COALESCE(EXCLUDED.is_default_invoice_contact,   contacts.is_default_invoice_contact),
    is_default_statement_contact = COALESCE(EXCLUDED.is_default_statement_contact, contacts.is_default_statement_contact),
    active                       = COALESCE(EXCLUDED.active,                       contacts.active),
    updated_at                   = now()
  RETURNING contact_id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_upsert_customer(p_external_id character varying, p_company_name character varying DEFAULT NULL::character varying, p_type character varying DEFAULT NULL::character varying, p_first_name character varying DEFAULT NULL::character varying, p_last_name character varying DEFAULT NULL::character varying, p_salutation character varying DEFAULT NULL::character varying, p_abn character varying DEFAULT NULL::character varying, p_acn character varying DEFAULT NULL::character varying, p_email character varying DEFAULT NULL::character varying, p_primary_phone character varying DEFAULT NULL::character varying, p_mobile_phone character varying DEFAULT NULL::character varying, p_alt_phone character varying DEFAULT NULL::character varying, p_website character varying DEFAULT NULL::character varying, p_street_address text DEFAULT NULL::text, p_suburb text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_postcode text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_customer_group character varying DEFAULT NULL::character varying, p_account_manager character varying DEFAULT NULL::character varying, p_currency character varying DEFAULT NULL::character varying, p_active boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id        uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  INSERT INTO app_data.customers (
    customer_id,    tenant_id,       external_id,
    company_name,   type,
    first_name,     last_name,       salutation,
    abn,            acn,
    email,          primary_phone,   mobile_phone,   alt_phone,    website,
    street_address, suburb,          state,          postcode,     country,
    customer_group, account_manager, currency,
    active
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_external_id,
    p_company_name, p_type,
    p_first_name, p_last_name, p_salutation,
    p_abn, p_acn,
    p_email, p_primary_phone, p_mobile_phone, p_alt_phone, p_website,
    p_street_address, p_suburb, p_state, p_postcode, COALESCE(p_country, 'AU'),
    p_customer_group, p_account_manager, p_currency,
    COALESCE(p_active, true)
  )
  ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    company_name    = COALESCE(EXCLUDED.company_name,    customers.company_name),
    type            = COALESCE(EXCLUDED.type,            customers.type),
    first_name      = COALESCE(EXCLUDED.first_name,      customers.first_name),
    last_name       = COALESCE(EXCLUDED.last_name,       customers.last_name),
    salutation      = COALESCE(EXCLUDED.salutation,      customers.salutation),
    abn             = COALESCE(EXCLUDED.abn,             customers.abn),
    acn             = COALESCE(EXCLUDED.acn,             customers.acn),
    email           = COALESCE(EXCLUDED.email,           customers.email),
    primary_phone   = COALESCE(EXCLUDED.primary_phone,   customers.primary_phone),
    mobile_phone    = COALESCE(EXCLUDED.mobile_phone,    customers.mobile_phone),
    alt_phone       = COALESCE(EXCLUDED.alt_phone,       customers.alt_phone),
    website         = COALESCE(EXCLUDED.website,         customers.website),
    street_address  = COALESCE(EXCLUDED.street_address,  customers.street_address),
    suburb          = COALESCE(EXCLUDED.suburb,          customers.suburb),
    state           = COALESCE(EXCLUDED.state,           customers.state),
    postcode        = COALESCE(EXCLUDED.postcode,        customers.postcode),
    country         = COALESCE(EXCLUDED.country,         customers.country),
    customer_group  = COALESCE(EXCLUDED.customer_group,  customers.customer_group),
    account_manager = COALESCE(EXCLUDED.account_manager, customers.account_manager),
    currency        = COALESCE(EXCLUDED.currency,        customers.currency),
    active          = COALESCE(EXCLUDED.active,          customers.active),
    updated_at      = now()
  RETURNING customer_id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.eq_upsert_site(p_external_id character varying, p_name character varying DEFAULT NULL::character varying, p_code character varying DEFAULT NULL::character varying, p_client_name text DEFAULT NULL::text, p_site_type character varying DEFAULT NULL::character varying, p_customer_id uuid DEFAULT NULL::uuid, p_external_customer_id character varying DEFAULT NULL::character varying, p_address_line_1 text DEFAULT NULL::text, p_address_line_2 text DEFAULT NULL::text, p_suburb text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_postcode text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_site_contact_name text DEFAULT NULL::text, p_site_contact_phone text DEFAULT NULL::text, p_site_contact_email text DEFAULT NULL::text, p_induction_required boolean DEFAULT NULL::boolean, p_induction_url text DEFAULT NULL::text, p_track_hours boolean DEFAULT NULL::boolean, p_budget_hours numeric DEFAULT NULL::numeric, p_active boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id        uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  INSERT INTO app_data.sites (
    site_id,             tenant_id,            external_id,
    name,                code,                 client_name,           site_type,
    customer_id,         external_customer_id,
    address_line_1,      address_line_2,
    suburb,              state,                postcode,              country,
    latitude,            longitude,
    site_contact_name,   site_contact_phone,   site_contact_email,
    induction_required,  induction_url,
    track_hours,         budget_hours,
    active
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_external_id,
    p_name, p_code, p_client_name, p_site_type,
    p_customer_id, p_external_customer_id,
    p_address_line_1, p_address_line_2,
    p_suburb, p_state, p_postcode, COALESCE(p_country, 'AU'),
    p_latitude, p_longitude,
    p_site_contact_name, p_site_contact_phone, p_site_contact_email,
    COALESCE(p_induction_required, false), p_induction_url,
    COALESCE(p_track_hours, false), p_budget_hours,
    COALESCE(p_active, true)
  )
  ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    name                 = COALESCE(EXCLUDED.name,                 sites.name),
    code                 = COALESCE(EXCLUDED.code,                 sites.code),
    client_name          = COALESCE(EXCLUDED.client_name,          sites.client_name),
    site_type            = COALESCE(EXCLUDED.site_type,            sites.site_type),
    customer_id          = COALESCE(EXCLUDED.customer_id,          sites.customer_id),
    external_customer_id = COALESCE(EXCLUDED.external_customer_id, sites.external_customer_id),
    address_line_1       = COALESCE(EXCLUDED.address_line_1,       sites.address_line_1),
    address_line_2       = COALESCE(EXCLUDED.address_line_2,       sites.address_line_2),
    suburb               = COALESCE(EXCLUDED.suburb,               sites.suburb),
    state                = COALESCE(EXCLUDED.state,                sites.state),
    postcode             = COALESCE(EXCLUDED.postcode,             sites.postcode),
    country              = COALESCE(EXCLUDED.country,              sites.country),
    latitude             = COALESCE(EXCLUDED.latitude,             sites.latitude),
    longitude            = COALESCE(EXCLUDED.longitude,            sites.longitude),
    site_contact_name    = COALESCE(EXCLUDED.site_contact_name,    sites.site_contact_name),
    site_contact_phone   = COALESCE(EXCLUDED.site_contact_phone,   sites.site_contact_phone),
    site_contact_email   = COALESCE(EXCLUDED.site_contact_email,   sites.site_contact_email),
    induction_required   = COALESCE(EXCLUDED.induction_required,   sites.induction_required),
    induction_url        = COALESCE(EXCLUDED.induction_url,        sites.induction_url),
    track_hours          = COALESCE(EXCLUDED.track_hours,          sites.track_hours),
    budget_hours         = COALESCE(EXCLUDED.budget_hours,         sites.budget_hours),
    active               = COALESCE(EXCLUDED.active,               sites.active),
    updated_at           = now()
  RETURNING site_id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── Grants: anon revoked, authenticated + service_role execute ────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'eq_archive_contact','eq_archive_customer','eq_archive_site',
      'eq_delete_contact','eq_delete_customer','eq_delete_site',
      'eq_unarchive_contact','eq_unarchive_customer','eq_unarchive_site',
      'eq_upsert_contact','eq_upsert_customer','eq_upsert_site','eq_list_sites')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon;', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;', r.sig);
  END LOOP;
END $$;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0022_canonical_write_rpcs', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
