-- Migration: 0131_restrict_site_credential_funcs
-- Target:    SKS tenant plane (ehowgjardagevnrluult) — no-op on other planes
-- Purpose:   Remove EXECUTE from the authenticated role on decrypt_site_credential
--            and upsert_site_credential. These functions store and decrypt site
--            passwords (control systems, SCADA, etc.) and must only be callable
--            server-side via service_role, not by any authenticated browser user.
--            Found via Supabase security advisor: authenticated role had EXECUTE
--            on both functions, allowing any logged-in user to access all credentials.
-- Idempotent: yes (has_function_privilege check before REVOKE)

BEGIN;

DO $$
BEGIN
  -- Only run on planes where these functions exist (ehow only)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'decrypt_site_credential'
  ) THEN
    RAISE NOTICE 'decrypt_site_credential not found — skipping 0131';
    RETURN;
  END IF;

  -- REVOKE authenticated execute on decrypt_site_credential
  IF has_function_privilege(
    'authenticated',
    'public.decrypt_site_credential(uuid, text)',
    'EXECUTE'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.decrypt_site_credential(uuid, text)
      FROM authenticated;
    RAISE NOTICE '0131: REVOKE EXECUTE decrypt_site_credential FROM authenticated — done';
  ELSE
    RAISE NOTICE '0131: decrypt_site_credential already restricted — skip';
  END IF;

  -- REVOKE authenticated execute on upsert_site_credential
  IF has_function_privilege(
    'authenticated',
    'public.upsert_site_credential(uuid, uuid, uuid, text, text, text, text, text, text, uuid)',
    'EXECUTE'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.upsert_site_credential(uuid, uuid, uuid, text, text, text, text, text, text, uuid)
      FROM authenticated;
    RAISE NOTICE '0131: REVOKE EXECUTE upsert_site_credential FROM authenticated — done';
  ELSE
    RAISE NOTICE '0131: upsert_site_credential already restricted — skip';
  END IF;
END $$;

COMMIT;
