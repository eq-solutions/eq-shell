-- Migration: 0081_pricing_admin_rpcs
-- Target:    Per-tenant data plane
-- Purpose:   Sprint "Setup UI" — let the business manage its own outlet pricing
--            without SQL. CRUD RPCs over pricing_config / pricing_materials /
--            pricing_products / pricing_bands (quote_templates already have
--            list/upsert/archive from 0075).
--
--   All SECURITY DEFINER, tenant-scoped via the JWT claim, REVOKE PUBLIC +
--   GRANT authenticated, matching the rest of the EQ Ops RPC surface.

-- ============================================================================
-- pricing_config — singleton per tenant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_get_pricing_config()
RETURNS TABLE (
  material_markup        numeric,
  labour_normal_rate     numeric,
  labour_supervisor_rate numeric,
  removal_base           numeric,
  removal_increment      numeric,
  removal_markup         numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT c.material_markup, c.labour_normal_rate, c.labour_supervisor_rate,
         c.removal_base, c.removal_increment, c.removal_markup
  FROM app_data.pricing_config c
  WHERE c.tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_get_pricing_config() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_get_pricing_config() TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_upsert_pricing_config(
  p_material_markup        numeric,
  p_labour_normal_rate     numeric,
  p_labour_supervisor_rate numeric,
  p_removal_base           numeric,
  p_removal_increment      numeric,
  p_removal_markup         numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  INSERT INTO app_data.pricing_config
    (tenant_id, material_markup, labour_normal_rate, labour_supervisor_rate,
     removal_base, removal_increment, removal_markup)
  VALUES
    (v_tenant_id, p_material_markup, p_labour_normal_rate, p_labour_supervisor_rate,
     p_removal_base, p_removal_increment, p_removal_markup)
  ON CONFLICT (tenant_id) DO UPDATE
  SET material_markup        = excluded.material_markup,
      labour_normal_rate     = excluded.labour_normal_rate,
      labour_supervisor_rate = excluded.labour_supervisor_rate,
      removal_base           = excluded.removal_base,
      removal_increment      = excluded.removal_increment,
      removal_markup         = excluded.removal_markup,
      updated_at             = now();
END;
$$;

REVOKE ALL ON FUNCTION public.eq_upsert_pricing_config(numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_upsert_pricing_config(numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- ============================================================================
-- pricing_materials — component catalogue
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_pricing_materials(
  p_include_archived boolean DEFAULT false
)
RETURNS TABLE (
  material_id uuid,
  part_no     text,
  description text,
  unit        text,
  unit_cost   numeric,
  sort_order  integer,
  archived    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT m.material_id, m.part_no::text, m.description::text, m.unit::text,
         m.unit_cost, m.sort_order, m.archived
  FROM app_data.pricing_materials m
  WHERE m.tenant_id = v_tenant_id
    AND (p_include_archived OR m.archived = false)
  ORDER BY m.sort_order, m.part_no;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_pricing_materials(boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_pricing_materials(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_upsert_pricing_material(
  p_material_id uuid    DEFAULT NULL,
  p_part_no     text    DEFAULT '',
  p_description text    DEFAULT '',
  p_unit        text    DEFAULT NULL,
  p_unit_cost   numeric DEFAULT 0,
  p_sort_order  integer DEFAULT 0
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

  IF p_material_id IS NULL THEN
    INSERT INTO app_data.pricing_materials
      (tenant_id, part_no, description, unit, unit_cost, sort_order)
    VALUES
      (v_tenant_id, p_part_no, p_description, NULLIF(trim(p_unit), ''), p_unit_cost, p_sort_order)
    RETURNING material_id INTO v_id;
  ELSE
    UPDATE app_data.pricing_materials
    SET part_no     = p_part_no,
        description = p_description,
        unit        = NULLIF(trim(p_unit), ''),
        unit_cost   = p_unit_cost,
        sort_order  = p_sort_order,
        updated_at  = now()
    WHERE material_id = p_material_id AND tenant_id = v_tenant_id;
    v_id := p_material_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_upsert_pricing_material(uuid, text, text, text, numeric, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_upsert_pricing_material(uuid, text, text, text, numeric, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_archive_pricing_material(
  p_material_id uuid,
  p_archived    boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  UPDATE app_data.pricing_materials
  SET archived = p_archived, updated_at = now()
  WHERE material_id = p_material_id AND tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_archive_pricing_material(uuid, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_archive_pricing_material(uuid, boolean) TO authenticated;

-- ============================================================================
-- pricing_products — outlet product types + BOM recipe
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_pricing_products_full(
  p_include_archived boolean DEFAULT false
)
RETURNS TABLE (
  product_id          uuid,
  name                text,
  brand               text,
  phase               text,
  plug_type           text,
  cable_material_id   uuid,
  cable_qty           numeric,
  outlet_material_id  uuid,
  outlet_qty          numeric,
  breaker_material_id uuid,
  breaker_qty         numeric,
  install_hours       numeric,
  mgmt_hours          numeric,
  sort_order          integer,
  archived            boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT p.product_id, p.name::text, p.brand::text, p.phase::text, p.plug_type::text,
         p.cable_material_id, p.cable_qty,
         p.outlet_material_id, p.outlet_qty,
         p.breaker_material_id, p.breaker_qty,
         p.install_hours, p.mgmt_hours, p.sort_order, p.archived
  FROM app_data.pricing_products p
  WHERE p.tenant_id = v_tenant_id
    AND p.category  = 'outlets'
    AND (p_include_archived OR p.archived = false)
  ORDER BY p.sort_order, p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_pricing_products_full(boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_pricing_products_full(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_upsert_pricing_product(
  p_product_id          uuid    DEFAULT NULL,
  p_name                text    DEFAULT '',
  p_brand               text    DEFAULT NULL,
  p_phase               text    DEFAULT NULL,
  p_plug_type           text    DEFAULT NULL,
  p_cable_material_id   uuid    DEFAULT NULL,
  p_cable_qty           numeric DEFAULT 0,
  p_outlet_material_id  uuid    DEFAULT NULL,
  p_outlet_qty          numeric DEFAULT 0,
  p_breaker_material_id uuid    DEFAULT NULL,
  p_breaker_qty         numeric DEFAULT 0,
  p_install_hours       numeric DEFAULT 0,
  p_mgmt_hours          numeric DEFAULT 0,
  p_sort_order          integer DEFAULT 0
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

  -- Validate referenced materials belong to this tenant (FK + isolation)
  IF p_cable_material_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_data.pricing_materials WHERE material_id = p_cable_material_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'cable material not found'; END IF;
  IF p_outlet_material_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_data.pricing_materials WHERE material_id = p_outlet_material_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'outlet material not found'; END IF;
  IF p_breaker_material_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_data.pricing_materials WHERE material_id = p_breaker_material_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'breaker material not found'; END IF;

  IF p_product_id IS NULL THEN
    INSERT INTO app_data.pricing_products
      (tenant_id, category, name, brand, phase, plug_type,
       cable_material_id, cable_qty, outlet_material_id, outlet_qty,
       breaker_material_id, breaker_qty, install_hours, mgmt_hours, sort_order)
    VALUES
      (v_tenant_id, 'outlets', p_name, p_brand, p_phase, p_plug_type,
       p_cable_material_id, p_cable_qty, p_outlet_material_id, p_outlet_qty,
       p_breaker_material_id, p_breaker_qty, p_install_hours, p_mgmt_hours, p_sort_order)
    RETURNING product_id INTO v_id;
  ELSE
    UPDATE app_data.pricing_products
    SET name                = p_name,
        brand               = p_brand,
        phase               = p_phase,
        plug_type           = p_plug_type,
        cable_material_id   = p_cable_material_id,
        cable_qty           = p_cable_qty,
        outlet_material_id  = p_outlet_material_id,
        outlet_qty          = p_outlet_qty,
        breaker_material_id = p_breaker_material_id,
        breaker_qty         = p_breaker_qty,
        install_hours       = p_install_hours,
        mgmt_hours          = p_mgmt_hours,
        sort_order          = p_sort_order,
        updated_at          = now()
    WHERE product_id = p_product_id AND tenant_id = v_tenant_id;
    v_id := p_product_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_upsert_pricing_product(uuid, text, text, text, text, uuid, numeric, uuid, numeric, uuid, numeric, numeric, numeric, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_upsert_pricing_product(uuid, text, text, text, text, uuid, numeric, uuid, numeric, uuid, numeric, numeric, numeric, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_archive_pricing_product(
  p_product_id uuid,
  p_archived   boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  UPDATE app_data.pricing_products
  SET archived = p_archived, updated_at = now()
  WHERE product_id = p_product_id AND tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_archive_pricing_product(uuid, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_archive_pricing_product(uuid, boolean) TO authenticated;

-- ============================================================================
-- pricing_bands — volume discount schedule (small; replace-all on save)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_pricing_bands(
  p_category text DEFAULT 'outlets'
)
RETURNS TABLE (
  band_id    uuid,
  min_qty    integer,
  max_qty    integer,
  factor     numeric,
  sort_order integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT b.band_id, b.min_qty, b.max_qty, b.factor, b.sort_order
  FROM app_data.pricing_bands b
  WHERE b.tenant_id = v_tenant_id AND b.category = p_category
  ORDER BY b.min_qty;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_pricing_bands(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_list_pricing_bands(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_replace_pricing_bands(
  p_category text,
  p_bands    jsonb
  -- [{min_qty, max_qty (nullable), factor, sort_order}, ...]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_band      jsonb;
  v_i         integer := 0;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  DELETE FROM app_data.pricing_bands
  WHERE tenant_id = v_tenant_id AND category = p_category;

  FOR v_band IN SELECT * FROM jsonb_array_elements(p_bands) LOOP
    v_i := v_i + 1;
    INSERT INTO app_data.pricing_bands
      (tenant_id, category, min_qty, max_qty, factor, sort_order)
    VALUES
      (v_tenant_id, p_category,
       (v_band->>'min_qty')::integer,
       NULLIF(v_band->>'max_qty', '')::integer,
       (v_band->>'factor')::numeric,
       COALESCE((v_band->>'sort_order')::integer, v_i * 10));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_replace_pricing_bands(text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_replace_pricing_bands(text, jsonb) TO authenticated;
