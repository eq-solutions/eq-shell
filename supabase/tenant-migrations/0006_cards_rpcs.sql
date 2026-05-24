-- Migration: 0006_cards_rpcs
-- Target:    Per-tenant data plane
-- Purpose:   Cards mobile RPCs on tenant DB. The Cards Flutter app uses
--            these four RPCs as its primary read/write surface for the
--            tradie's own profile + licences:
--
--              eq_cards_current_staff()              → staff fields
--              eq_cards_list_my_licences()           → licences[]
--              eq_cards_upsert_my_licence(payload)   → returns row
--              eq_cards_soft_delete_my_licence(id)   → void
--
--            On shared eq-canonical these read tenant_id + user_id from
--            auth.jwt() app_metadata. The tenant-DB versions take both
--            explicitly because service-role callers (the cards-api
--            Netlify function) have no JWT context.
--
--            Return shapes are identical to the shared versions so the
--            Cards Flutter model layer doesn't change — only the call
--            site (sb.rpc → http.post to cards-api).

-- ──────────────────────────────────────────────────────────────────────
-- eq_cards_current_staff: return the staff row for (tenant, user).
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_cards_current_staff(
  p_tenant_id uuid,
  p_user_id   uuid
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
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id and p_user_id are required';
  END IF;

  RETURN QUERY
  SELECT
    s.staff_id AS id,
    NULLIF(TRIM(BOTH ' ' FROM (COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, ''))), '') AS full_name,
    s.date_of_birth,
    s.phone AS mobile,
    s.email,
    s.address_street, s.address_suburb, s.address_state, s.address_postcode,
    s.emergency_contact_name, s.emergency_contact_relationship, s.emergency_contact_mobile,
    s.created_at, s.updated_at,
    NULL::timestamptz AS deleted_at
  FROM app_data.staff s
  WHERE s.tenant_id = p_tenant_id
    AND s.user_id   = p_user_id
    AND s.active    = true
  LIMIT 1;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_cards_current_staff(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_cards_current_staff(uuid, uuid) TO service_role;

-- ──────────────────────────────────────────────────────────────────────
-- eq_cards_list_my_licences: licences for the (tenant, user)'s staff row.
-- Column rename preserved: photo_*_path returned as photo_*_url for the
-- Flutter model's backward compat (Cards Unit 4 history).
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_cards_list_my_licences(
  p_tenant_id uuid,
  p_user_id   uuid
)
RETURNS TABLE(
  id                  uuid,
  user_id             uuid,
  licence_type        text,
  licence_number      text,
  issuing_authority   text,
  state               text,
  issue_date          date,
  expiry_date         date,
  photo_front_url     text,
  photo_back_url      text,
  notes               text,
  metadata            jsonb,
  created_at          timestamptz,
  updated_at          timestamptz,
  deleted_at          timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_staff uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id and p_user_id are required';
  END IF;

  SELECT s.staff_id INTO v_staff
  FROM app_data.staff s
  WHERE s.tenant_id = p_tenant_id AND s.user_id = p_user_id AND s.active = true
  LIMIT 1;

  IF v_staff IS NULL THEN
    RETURN;   -- empty wallet
  END IF;

  RETURN QUERY
  SELECT
    l.licence_id      AS id,
    l.staff_id        AS user_id,
    l.licence_type::text,
    l.licence_number::text,
    l.issuing_authority::text,
    l.state::text,
    l.issue_date, l.expiry_date,
    l.photo_front_path AS photo_front_url,
    l.photo_back_path  AS photo_back_url,
    l.notes, l.metadata,
    l.created_at, l.updated_at,
    NULL::timestamptz  AS deleted_at
  FROM app_data.licences l
  WHERE l.tenant_id = p_tenant_id
    AND l.staff_id  = v_staff
    AND l.active    = true
  ORDER BY l.expiry_date ASC NULLS LAST;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_cards_list_my_licences(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_cards_list_my_licences(uuid, uuid) TO service_role;

-- ──────────────────────────────────────────────────────────────────────
-- eq_cards_upsert_my_licence: insert or update for the (tenant, user)'s
-- staff. id in payload → upsert; missing id → generate.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_cards_upsert_my_licence(
  p_tenant_id uuid,
  p_user_id   uuid,
  p_payload   jsonb
)
RETURNS TABLE(
  id                  uuid,
  user_id             uuid,
  licence_type        text,
  licence_number      text,
  issuing_authority   text,
  state               text,
  issue_date          date,
  expiry_date         date,
  photo_front_url     text,
  photo_back_url      text,
  notes               text,
  metadata            jsonb,
  created_at          timestamptz,
  updated_at          timestamptz,
  deleted_at          timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_staff      uuid;
  v_licence_id uuid;
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

  v_licence_id := COALESCE((p_payload ->> 'id')::uuid, gen_random_uuid());

  INSERT INTO app_data.licences (
    licence_id, tenant_id, staff_id,
    licence_type, licence_number,
    issuing_authority, state,
    issue_date, expiry_date,
    photo_front_path, photo_back_path,
    notes, metadata, active,
    imported_from, schema_version
  ) VALUES (
    v_licence_id, p_tenant_id, v_staff,
    p_payload ->> 'licence_type',
    p_payload ->> 'licence_number',
    p_payload ->> 'issuing_authority',
    UPPER(NULLIF(p_payload ->> 'state', '')),
    NULLIF(p_payload ->> 'issue_date', '')::date,
    NULLIF(p_payload ->> 'expiry_date', '')::date,
    NULLIF(p_payload ->> 'photo_front_url', ''),
    NULLIF(p_payload ->> 'photo_back_url', ''),
    NULLIF(p_payload ->> 'notes', ''),
    COALESCE(p_payload -> 'metadata', '{}'::jsonb),
    true,
    'cards_app_runtime',
    '1.0.0'
  )
  ON CONFLICT (licence_id) DO UPDATE SET
    licence_type      = EXCLUDED.licence_type,
    licence_number    = EXCLUDED.licence_number,
    issuing_authority = EXCLUDED.issuing_authority,
    state             = EXCLUDED.state,
    issue_date        = EXCLUDED.issue_date,
    expiry_date       = EXCLUDED.expiry_date,
    photo_front_path  = EXCLUDED.photo_front_path,
    photo_back_path   = EXCLUDED.photo_back_path,
    notes             = EXCLUDED.notes,
    metadata          = EXCLUDED.metadata,
    updated_at        = now();

  RETURN QUERY
  SELECT l.licence_id, l.staff_id,
         l.licence_type::text, l.licence_number::text,
         l.issuing_authority::text, l.state::text,
         l.issue_date, l.expiry_date,
         l.photo_front_path, l.photo_back_path,
         l.notes, l.metadata,
         l.created_at, l.updated_at,
         NULL::timestamptz
  FROM app_data.licences l
  WHERE l.licence_id = v_licence_id;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_cards_upsert_my_licence(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_cards_upsert_my_licence(uuid, uuid, jsonb) TO service_role;

-- ──────────────────────────────────────────────────────────────────────
-- eq_cards_soft_delete_my_licence: set active=false on the licence,
-- scoped to (tenant, user)'s staff. Raises if not found.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_cards_soft_delete_my_licence(
  p_tenant_id uuid,
  p_user_id   uuid,
  p_licence_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_staff uuid;
  v_count int;
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL OR p_licence_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id, p_user_id, p_licence_id are required';
  END IF;

  SELECT s.staff_id INTO v_staff
  FROM app_data.staff s
  WHERE s.tenant_id = p_tenant_id AND s.user_id = p_user_id AND s.active = true
  LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'no active staff record for current user';
  END IF;

  UPDATE app_data.licences
     SET active = false, updated_at = now()
   WHERE licence_id = p_licence_id
     AND tenant_id  = p_tenant_id
     AND staff_id   = v_staff;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'licence not found or not yours';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_cards_soft_delete_my_licence(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_cards_soft_delete_my_licence(uuid, uuid, uuid) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0006_cards_rpcs', NULL)
  ON CONFLICT (name) DO NOTHING;
