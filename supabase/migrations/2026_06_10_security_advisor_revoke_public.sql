-- Migration: 2026_06_10_security_advisor_revoke_public
-- Target:    eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Fix missed PUBLIC revoke on SECURITY DEFINER functions.
--            REVOKE FROM anon/authenticated in 2026_06_10_security_advisor_control
--            removed explicit role grants but not the implicit PUBLIC grant every
--            function receives at creation. anon inherits EXECUTE from PUBLIC,
--            so the advisor still fires.
--            Solution: REVOKE FROM PUBLIC, then GRANT back to authenticated where needed.

-- Trigger functions — never callable by clients directly
REVOKE ALL ON FUNCTION public.fn_link_shell_user_on_worker_upsert() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'shell_control' AND p.proname = 'fn_link_worker_on_user_create'
  ) THEN
    REVOKE ALL ON FUNCTION shell_control.fn_link_worker_on_user_create() FROM PUBLIC;
  END IF;
END $$;

-- eq_cards_delete_account — requires authenticated session; called as authenticated RPC
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_delete_account'
  ) THEN
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_delete_account('
             || pg_get_function_arguments(p.oid) || ') FROM PUBLIC'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_delete_account'
      LIMIT 1
    );
    EXECUTE (
      SELECT 'GRANT EXECUTE ON FUNCTION public.eq_cards_delete_account('
             || pg_get_function_arguments(p.oid) || ') TO authenticated'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_delete_account'
      LIMIT 1
    );
  END IF;
END $$;

-- eq_cards_get_worker_hr_record — requires authenticated session
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_get_worker_hr_record'
  ) THEN
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_get_worker_hr_record('
             || pg_get_function_arguments(p.oid) || ') FROM PUBLIC'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_get_worker_hr_record'
      LIMIT 1
    );
    EXECUTE (
      SELECT 'GRANT EXECUTE ON FUNCTION public.eq_cards_get_worker_hr_record('
             || pg_get_function_arguments(p.oid) || ') TO authenticated'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_get_worker_hr_record'
      LIMIT 1
    );
  END IF;
END $$;

-- eq_cards_claim_invite / eq_cards_preview_invite — onboarding token functions;
--   called via Edge Functions (service_role) or as authenticated RPC.
--   Removing PUBLIC grant means anon cannot call directly — grant authenticated as defensive.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_claim_invite'
  ) THEN
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_claim_invite('
             || pg_get_function_arguments(p.oid) || ') FROM PUBLIC'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_claim_invite'
      LIMIT 1
    );
    EXECUTE (
      SELECT 'GRANT EXECUTE ON FUNCTION public.eq_cards_claim_invite('
             || pg_get_function_arguments(p.oid) || ') TO authenticated'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_claim_invite'
      LIMIT 1
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eq_cards_preview_invite'
  ) THEN
    EXECUTE (
      SELECT 'REVOKE ALL ON FUNCTION public.eq_cards_preview_invite('
             || pg_get_function_arguments(p.oid) || ') FROM PUBLIC'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_preview_invite'
      LIMIT 1
    );
    EXECUTE (
      SELECT 'GRANT EXECUTE ON FUNCTION public.eq_cards_preview_invite('
             || pg_get_function_arguments(p.oid) || ') TO authenticated'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'eq_cards_preview_invite'
      LIMIT 1
    );
  END IF;
END $$;
