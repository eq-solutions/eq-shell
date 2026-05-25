-- Migration: 2026_05_25c_auth_hook_full_claims
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Upgrade custom_access_token_hook to stamp eq_role and
--            is_platform_admin from shell_control.users into every JWT,
--            in addition to the tenant_id already stamped by the v1 hook
--            (2026_05_24b_auth_hook_tenant_id).
--
--            Previously, role changes in shell_control.users required a
--            manual UPDATE to auth.users.raw_app_meta_data to take effect
--            in JWTs. This upgrade makes shell_control.users the single
--            source of truth for all three claims; raw_app_meta_data is no
--            longer manually maintained.
--
-- Applied via MCP at 2026-05-25. Idempotent (CREATE OR REPLACE).
-- Hook must remain enabled in Dashboard: Authentication → Hooks →
-- Custom Access Token → public.custom_access_token_hook.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'shell_control', 'pg_temp'
AS $function$
DECLARE
  v_user_id           uuid;
  v_tenant_id         uuid;
  v_role              text;
  v_is_platform_admin boolean;
  v_claims            jsonb;
  v_app_meta          jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := COALESCE(event -> 'claims', '{}'::jsonb);

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('claims', v_claims);
  END IF;

  SELECT u.tenant_id, u.role::text, u.is_platform_admin
  INTO v_tenant_id, v_role, v_is_platform_admin
  FROM shell_control.users u
  WHERE u.id = v_user_id
  LIMIT 1;

  -- User not yet provisioned — pass through; downstream returns 401.
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('claims', v_claims);
  END IF;

  v_app_meta := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb)
    || jsonb_build_object(
         'tenant_id',         v_tenant_id::text,
         'eq_role',           v_role,
         'is_platform_admin', v_is_platform_admin
       );
  v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_meta, true);

  RETURN jsonb_build_object('claims', v_claims);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT  USAGE   ON SCHEMA public TO supabase_auth_admin;
