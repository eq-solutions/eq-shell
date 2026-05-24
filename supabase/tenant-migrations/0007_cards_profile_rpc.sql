-- Migration: 0007_cards_profile_rpc
-- Target:    Per-tenant data plane
-- Purpose:   The fifth Cards mobile RPC. 0006 covered the licence-family
--            ops; this one covers the tradie's own profile (name, dob,
--            address, emergency contacts). Splits full_name into
--            first_name/last_name on first whitespace — preserves the
--            Cards UX where the user types one combined name.
--
--            Takes p_tenant_id + p_user_id explicitly (service-role
--            callers carry no JWT context). Returns the staff row in
--            the same shape eq_cards_current_staff returns, so the
--            Cards Flutter Profile model is unchanged.

CREATE OR REPLACE FUNCTION public.eq_cards_upsert_my_profile(
  p_tenant_id uuid,
  p_user_id   uuid,
  p_payload   jsonb
)
RETURNS TABLE(
  id                              uuid,
  full_name                       text,
  date_of_birth                   date,
  mobile                          text,
  email                           text,
  address_street                  text,
  address_suburb                  text,
  address_state                   text,
  address_postcode                text,
  emergency_contact_name          text,
  emergency_contact_relationship  text,
  emergency_contact_mobile        text,
  created_at                      timestamptz,
  updated_at                      timestamptz,
  deleted_at                      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_staff   uuid;
  v_full    text;
  v_first   text;
  v_last    text;
  v_sp_idx  int;
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id and p_user_id are required';
  END IF;

  SELECT s.staff_id INTO v_staff
  FROM app_data.staff s
  WHERE s.tenant_id = p_tenant_id AND s.user_id = p_user_id AND s.active = true
  LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'no active staff record for current user';
  END IF;

  v_full := NULLIF(TRIM(BOTH ' ' FROM (p_payload ->> 'full_name')), '');
  IF v_full IS NOT NULL THEN
    v_sp_idx := position(' ' IN v_full);
    IF v_sp_idx > 0 THEN
      v_first := substring(v_full FROM 1 FOR v_sp_idx - 1);
      v_last  := substring(v_full FROM v_sp_idx + 1);
    ELSE
      v_first := v_full;
      v_last  := v_full;
    END IF;
  END IF;

  UPDATE app_data.staff SET
    first_name                     = COALESCE(v_first, first_name),
    last_name                      = COALESCE(v_last,  last_name),
    date_of_birth                  = COALESCE(NULLIF(p_payload ->> 'date_of_birth', '')::date, date_of_birth),
    phone                          = COALESCE(NULLIF(p_payload ->> 'mobile', ''), phone),
    email                          = COALESCE(NULLIF(p_payload ->> 'email',  ''), email),
    address_street                 = COALESCE(NULLIF(p_payload ->> 'address_street', ''), address_street),
    address_suburb                 = COALESCE(NULLIF(p_payload ->> 'address_suburb', ''), address_suburb),
    address_state                  = COALESCE(UPPER(NULLIF(p_payload ->> 'address_state', '')), address_state),
    address_postcode               = COALESCE(NULLIF(p_payload ->> 'address_postcode', ''), address_postcode),
    emergency_contact_name         = COALESCE(NULLIF(p_payload ->> 'emergency_contact_name', ''), emergency_contact_name),
    emergency_contact_relationship = COALESCE(NULLIF(p_payload ->> 'emergency_contact_relationship', ''), emergency_contact_relationship),
    emergency_contact_mobile       = COALESCE(NULLIF(p_payload ->> 'emergency_contact_mobile', ''), emergency_contact_mobile),
    updated_at                     = now()
  WHERE staff_id = v_staff;

  -- Return the freshly-updated staff row via the same shape current_staff
  -- returns. We pass the explicit params through.
  RETURN QUERY SELECT * FROM public.eq_cards_current_staff(p_tenant_id, p_user_id);
END
$function$;

REVOKE ALL ON FUNCTION public.eq_cards_upsert_my_profile(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_cards_upsert_my_profile(uuid, uuid, jsonb) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0007_cards_profile_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
