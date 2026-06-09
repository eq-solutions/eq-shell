-- Migration: 0061_security_advisor_revoke_public
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Fix missed PUBLIC revoke on SECURITY DEFINER functions.
--            REVOKE FROM anon/authenticated in 0059 removed explicit role grants
--            but not the implicit PUBLIC grant every function receives at creation.
--            anon inherits EXECUTE from PUBLIC, so the advisor still fires.
--            Solution: REVOKE FROM PUBLIC, then GRANT back to authenticated where needed.

-- ehowg: _admin_rekey_site_credential — admin-only, no client access
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_admin_rekey_site_credential'
  ) THEN
    REVOKE ALL ON FUNCTION public._admin_rekey_site_credential(uuid, text) FROM PUBLIC;
  END IF;
END $$;

-- ehowg: decrypt_site_credential — JWT tenant check inside; authenticated may call via RPC
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'decrypt_site_credential'
  ) THEN
    REVOKE ALL ON FUNCTION public.decrypt_site_credential(uuid, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.decrypt_site_credential(uuid, text) TO authenticated;
  END IF;
END $$;

-- ehowg: upsert_site_credential — JWT tenant check inside; authenticated may call via RPC
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_site_credential'
  ) THEN
    REVOKE ALL ON FUNCTION
      public.upsert_site_credential(uuid, uuid, uuid, text, text, text, text, text, text, uuid)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION
      public.upsert_site_credential(uuid, uuid, uuid, text, text, text, text, text, text, uuid)
      TO authenticated;
  END IF;
END $$;

-- zaap: ts_reminder_claim — managers send reminders; authenticated access retained
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ts_reminder_claim'
  ) THEN
    REVOKE ALL ON FUNCTION
      public.ts_reminder_claim(uuid, text, text, text, text, numeric)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION
      public.ts_reminder_claim(uuid, text, text, text, text, numeric)
      TO authenticated;
  END IF;
END $$;
