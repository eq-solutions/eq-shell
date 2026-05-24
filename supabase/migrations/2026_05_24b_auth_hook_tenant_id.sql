-- Migration: 2026_05_24b_auth_hook_tenant_id
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only — not tenant DBs
-- Purpose:   Supabase auth hook that auto-injects app_metadata.tenant_id
--            into every JWT at mint time, looked up from
--            shell_control.users.
--
--            Replaces the manual app_metadata backfill that we needed
--            on 2026-05-24 after the Cards mobile cutover. Direct
--            Supabase sign-ins (Cards mobile uses
--            supabase.auth.signInWithPassword, not Shell's
--            mint-supabase-jwt) carry only what's in
--            auth.users.raw_app_meta_data — which by default is just
--            { provider, providers }, with no tenant_id. The new
--            per-tenant Netlify functions (cards-api, intake-commit,
--            canonical-api, tenant-dashboard, entity-rows) all reject
--            JWTs without tenant_id with 401 jwt_missing_tenant_or_user.
--
--            This hook closes the gap permanently: when a user signs in,
--            Supabase Auth calls public.custom_access_token_hook(event)
--            and merges whatever 'claims' patch it returns into the JWT.
--            We look up the user's tenant_id from shell_control.users
--            and stamp it onto app_metadata.
--
-- IMPORTANT:  Creating the function is half the work. The hook must
--             also be ENABLED in the Supabase dashboard:
--               Authentication → Hooks → Custom Access Token →
--               toggle on, select 'public.custom_access_token_hook',
--               save.
--             Until that toggle flips, the function exists but Supabase
--             doesn't invoke it. Manual step because Supabase Management
--             API for auth hooks isn't exposed via the MCP we have.
--
-- Rollback:   1) Toggle the hook off in the dashboard (instant — JWTs
--                immediately revert to default claims).
--             2) DROP FUNCTION public.custom_access_token_hook(jsonb);
--                REVOKE … (see bottom).
--             Existing live JWTs are unaffected — they're already signed
--             and carry whatever claims they were minted with.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'shell_control', 'pg_temp'
AS $function$
DECLARE
  v_user_id    uuid;
  v_tenant_id  uuid;
  v_claims     jsonb;
  v_app_meta   jsonb;
BEGIN
  -- Supabase Auth invokes us with:
  --   event = { user_id: <uuid>, claims: { ... existing claims ... }, ... }
  -- We must return: { claims: <merged claims> } or the JWT mint fails.
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := COALESCE(event -> 'claims', '{}'::jsonb);

  -- No user_id (shouldn't happen) — pass claims through unchanged.
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('claims', v_claims);
  END IF;

  -- Look up the user's tenant from the control plane. shell_control.users
  -- is the source of truth; auth.users is what Supabase manages, and the
  -- two share the same UUID (shell_control.users.id = auth.users.id).
  SELECT u.tenant_id INTO v_tenant_id
  FROM shell_control.users u
  WHERE u.id = v_user_id
  LIMIT 1;

  -- User exists in auth.users but not in shell_control (e.g. direct
  -- Supabase sign-up that hasn't been provisioned). Pass through —
  -- downstream functions will return 401 jwt_missing_tenant_or_user,
  -- which is the correct behaviour.
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('claims', v_claims);
  END IF;

  -- Merge tenant_id into app_metadata. Preserve any existing keys
  -- (provider, providers, etc.) — we only stamp tenant_id.
  v_app_meta := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb)
                || jsonb_build_object('tenant_id', v_tenant_id::text);
  v_claims   := jsonb_set(v_claims, '{app_metadata}', v_app_meta, true);

  RETURN jsonb_build_object('claims', v_claims);
END
$function$;

-- The hook runs as supabase_auth_admin. Grant EXECUTE to that role
-- specifically; revoke from everything else. The SECURITY DEFINER above
-- means the function runs with the privileges of its owner (postgres)
-- which is what lets it read shell_control.users — supabase_auth_admin
-- has no privileges on shell_control by design.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- And we need supabase_auth_admin to be allowed to actually CALL the
-- function. Schema usage on public is normally there by default; this is
-- belt-and-braces.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
