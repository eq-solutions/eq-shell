-- Migration: 2026_05_28_field_tenant_slug
-- Target:    eq-canonical (jvknxcmbtrfnxfrwfimn)
-- Purpose:   Link each Shell tenant to a specific EQ Field workspace.
--
--   field_tenant_slug is the slug the Field iframe router uses to pick a
--   workspace (eq, sks, demo-traces, melbourne). Tenants whose slug already
--   matches a Field slug get auto-populated; 'core' stays null so platform
--   admins continue to use the picker (with sessionStorage memory on the
--   frontend).
--
--   Admin → Settings exposes this as a dropdown so the default Field workspace
--   can be changed without a code deploy.
--
-- Applied 2026-05-28 via MCP.

BEGIN;

ALTER TABLE shell_control.tenants
  ADD COLUMN field_tenant_slug text
    CHECK (field_tenant_slug IN ('eq', 'demo-trades', 'melbourne', 'sks'));

-- Tenants whose slug matches a Field slug get the value for free.
UPDATE shell_control.tenants
SET field_tenant_slug = slug
WHERE slug IN ('eq', 'demo-trades', 'melbourne', 'sks');

-- Must drop before recreating with a different RETURNS TABLE signature.
DROP FUNCTION IF EXISTS public.eq_update_tenant_settings(jsonb);
DROP FUNCTION IF EXISTS public.eq_get_tenant_settings();

CREATE FUNCTION public.eq_get_tenant_settings()
RETURNS TABLE(
  id                uuid,
  slug              text,
  name              text,
  brand_color       text,
  brand_logo_url    text,
  active            boolean,
  field_tenant_slug text,
  modules           jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'shell_control', 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid;
  v_role   text;
  v_pa     boolean;
BEGIN
  v_tenant := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  v_role   := auth.jwt() -> 'app_metadata' ->> 'eq_role';
  v_pa     := COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean, false);

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant in JWT'; END IF;
  IF v_role <> 'manager' AND NOT v_pa THEN
    RAISE EXCEPTION 'forbidden: manager or platform_admin required';
  END IF;

  RETURN QUERY
  SELECT t.id, t.slug, t.name, t.brand_color, t.brand_logo_url, t.active,
         t.field_tenant_slug,
         COALESCE(
           (SELECT jsonb_agg(jsonb_build_object('module', e.module, 'enabled', e.enabled)
                             ORDER BY e.module)
            FROM shell_control.module_entitlements e
            WHERE e.tenant_id = t.id),
           '[]'::jsonb
         ) AS modules
  FROM shell_control.tenants t
  WHERE t.id = v_tenant;
END $function$;

CREATE FUNCTION public.eq_update_tenant_settings(p_payload jsonb)
RETURNS TABLE(
  id                uuid,
  slug              text,
  name              text,
  brand_color       text,
  brand_logo_url    text,
  active            boolean,
  field_tenant_slug text,
  modules           jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'shell_control', 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid;
  v_role   text;
  v_pa     boolean;
  v_module jsonb;
BEGIN
  v_tenant := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  v_role   := auth.jwt() -> 'app_metadata' ->> 'eq_role';
  v_pa     := COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean, false);

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant in JWT'; END IF;
  IF v_role <> 'manager' AND NOT v_pa THEN
    RAISE EXCEPTION 'forbidden: manager or platform_admin required';
  END IF;

  UPDATE shell_control.tenants SET
    name           = COALESCE(NULLIF(p_payload ->> 'name', ''), name),
    brand_color    = CASE
                       WHEN p_payload ? 'brand_color' THEN NULLIF(p_payload ->> 'brand_color', '')
                       ELSE brand_color
                     END,
    brand_logo_url = CASE
                       WHEN p_payload ? 'brand_logo_url' THEN NULLIF(p_payload ->> 'brand_logo_url', '')
                       ELSE brand_logo_url
                     END,
    field_tenant_slug = CASE
                          WHEN p_payload ? 'field_tenant_slug' AND v_pa
                            THEN NULLIF(p_payload ->> 'field_tenant_slug', '')
                          ELSE field_tenant_slug
                        END,
    updated_at     = NOW()
  WHERE shell_control.tenants.id = v_tenant;

  IF p_payload ? 'modules' AND v_pa THEN
    FOR v_module IN SELECT * FROM jsonb_array_elements(p_payload -> 'modules')
    LOOP
      INSERT INTO shell_control.module_entitlements (tenant_id, module, enabled)
      VALUES (v_tenant, v_module ->> 'module', (v_module ->> 'enabled')::boolean)
      ON CONFLICT (tenant_id, module) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        updated_at = NOW();
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT gs.id, gs.slug, gs.name, gs.brand_color, gs.brand_logo_url, gs.active,
           gs.field_tenant_slug, gs.modules
    FROM public.eq_get_tenant_settings() gs;
END $function$;

REVOKE EXECUTE ON FUNCTION public.eq_get_tenant_settings() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_get_tenant_settings() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.eq_update_tenant_settings(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_update_tenant_settings(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
