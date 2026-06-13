-- Migration: 0085_harden_eq_ops_grants
-- Target:    Per-tenant data plane
-- Purpose:   Security hardening — remove anon EXECUTE from the EQ Ops RPC surface.
--
--   Supabase default-grants EXECUTE on new public functions to BOTH anon and
--   authenticated. Our quote/pricing migrations revoked PUBLIC but not anon, so the
--   Supabase security advisor (rule 0028, anon_security_definer_function_executable)
--   flagged 37 eq_* SECURITY DEFINER functions as callable by the anonymous role via
--   /rest/v1/rpc/* — including every write RPC and the internal rollup helper
--   eq__recompute_quote_totals, which has NO tenant check by design.
--
--   The quotes app only ever calls these as an authenticated user carrying a tenant
--   claim, so anon must never reach them. This revokes EXECUTE from anon on every
--   public eq_* function, and additionally locks the internal helper away from
--   authenticated (only the other SECURITY DEFINER functions, owned by the definer,
--   may call it — those calls run as the owner and are unaffected).
--
-- Idempotent: REVOKE is idempotent, and the loop reflects the current eq_* surface.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'public.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'eq\_%'
  LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM anon';
  END LOOP;
END $$;

-- Internal-only helper: no end user (anon or authenticated) may call it directly.
-- Its only legitimate callers are eq_add_line_item / eq_replace_line_items
-- (SECURITY DEFINER), whose internal call runs as the function owner.
REVOKE EXECUTE ON FUNCTION public.eq__recompute_quote_totals(uuid) FROM anon, authenticated;
