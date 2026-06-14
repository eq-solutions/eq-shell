-- Migration: 0093_rate_preset_admin
-- Target:    Per-tenant data plane
-- Purpose:   EQ Ops parity sprint — Wave 2 (Setup admin).
--
--   Rate presets (the quick-add line-item library estimators click in the quote
--   form) were seed-only and read-only — eq_list_rate_presets exists but there was
--   no way to add/edit/retire one without raw SQL. This adds:
--     eq_list_rate_presets_admin  — all presets incl. inactive (for the Setup tab)
--     eq_upsert_rate_preset       — insert (null id) or update
--     eq_archive_rate_preset      — set active flag (archive = false, un-archive = true)
--
--   The quote-form picker keeps using eq_list_rate_presets (active only).
--   Mirrors the pricing-material admin pattern from 0081.
--
-- All idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.eq_list_rate_presets_admin()
RETURNS TABLE (
  preset_id uuid, category text, description text, unit text,
  unit_rate_cents bigint, qty_thousandths bigint, sort_order integer, active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT p.preset_id, p.category, p.description::text, p.unit::text,
         p.unit_rate_cents, p.qty_thousandths, p.sort_order, p.active
  FROM app_data.quote_rate_presets p
  WHERE p.tenant_id = v_tenant_id
  ORDER BY p.active DESC, p.category NULLS LAST, p.sort_order, p.description;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_rate_presets_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_list_rate_presets_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_upsert_rate_preset(
  p_preset_id       uuid,
  p_category        text,
  p_description     text,
  p_unit            text,
  p_unit_rate_cents bigint,
  p_qty_thousandths bigint   DEFAULT 1000,
  p_sort_order      integer  DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_id        uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF p_description IS NULL OR trim(p_description) = '' THEN
    RAISE EXCEPTION 'preset description is required';
  END IF;

  IF p_preset_id IS NULL THEN
    INSERT INTO app_data.quote_rate_presets
      (tenant_id, category, description, unit, unit_rate_cents, qty_thousandths, sort_order, active)
    VALUES
      (v_tenant_id, NULLIF(trim(p_category), ''), p_description, NULLIF(trim(p_unit), ''),
       COALESCE(p_unit_rate_cents, 0), COALESCE(p_qty_thousandths, 1000), COALESCE(p_sort_order, 0), true)
    RETURNING preset_id INTO v_id;
  ELSE
    UPDATE app_data.quote_rate_presets
    SET category        = NULLIF(trim(p_category), ''),
        description     = p_description,
        unit            = NULLIF(trim(p_unit), ''),
        unit_rate_cents = COALESCE(p_unit_rate_cents, 0),
        qty_thousandths = COALESCE(p_qty_thousandths, 1000),
        sort_order      = COALESCE(p_sort_order, 0),
        updated_at      = now()
    WHERE preset_id = p_preset_id AND tenant_id = v_tenant_id
    RETURNING preset_id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'preset not found or access denied';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_upsert_rate_preset(uuid, text, text, text, bigint, bigint, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_upsert_rate_preset(uuid, text, text, text, bigint, bigint, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_archive_rate_preset(p_preset_id uuid, p_active boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  UPDATE app_data.quote_rate_presets
  SET active = p_active, updated_at = now()
  WHERE preset_id = p_preset_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preset not found or access denied';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_archive_rate_preset(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_archive_rate_preset(uuid, boolean) TO authenticated;
