-- Migration: 0053_bulletproof_user_creation
-- Applied:   2026-04-19 via Supabase MCP
-- Purpose:
--   1. Fix the crash in handle_new_user() introduced by 0046: `ORDER BY ts.created_at`
--      references a column that does not exist on tenant_settings. Every
--      auth.users insert (signup + invite) was failing with:
--        "500: Database error saving new user"
--        "ERROR: column ts.created_at does not exist (SQLSTATE 42703)"
--   2. Make the trigger *bulletproof*: wrap the body in EXCEPTION so no internal
--      error can ever block an auth.users insert. Worst case, the profile is
--      created without extras and the server action heals it.
--   3. Strip tenant-assignment logic out of the trigger. Tenant membership is
--      now assigned authoritatively by the inviteUserAction server action
--      (visible, audited, debuggable). The trigger creates the profile only.
--   4. Default new profiles to role='technician' (a valid app role) instead of
--      the legacy 'user' which none of the app's role checks accept.
--   5. Backfill: demo user has role='user' — promote to 'super_admin' to match
--      their tenant_members role. Any other stragglers on 'user' → 'technician'.
--
-- Rollback notes:
--   -- restore prior body of handle_new_user() from migration 0046 if needed.

BEGIN;

-- ============================================================
-- 1. Hardened handle_new_user() — profile creation only, never blocks auth
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := 'technician';
  v_admin_emails text[] := ARRAY['dev@eq.solutions','royce@eq.solutions'];
BEGIN
  IF new.email = ANY(v_admin_emails) THEN
    v_role := 'super_admin';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (
      new.id,
      new.email,
      COALESCE(new.raw_user_meta_data->>'full_name',''),
      v_role,
      true
    )
    ON CONFLICT (id) DO UPDATE
      SET email     = EXCLUDED.email,
          full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
  EXCEPTION WHEN OTHERS THEN
    -- Profile creation must never block auth.users insert. If something
    -- goes wrong (constraint drift, etc) log and continue — the server-side
    -- invite/repair action will heal the profile.
    RAISE WARNING 'handle_new_user: failed to upsert profile for % (%): %', new.email, new.id, SQLERRM;
  END;

  RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Bulletproof signup trigger — creates profile row only. Never raises. Tenant membership is assigned by the inviteUserAction server action, not the trigger.';

-- ============================================================
-- 2. Backfill: demo user must be super_admin (already is in tenant_members)
-- ============================================================
UPDATE public.profiles
   SET role = 'super_admin'
 WHERE email = 'demo@eqsolves.com.au'
   AND role = 'user';

-- ============================================================
-- 3. Promote any other profile still on legacy 'user' role to 'technician'
--    so app role checks behave predictably.
-- ============================================================
UPDATE public.profiles
   SET role = 'technician'
 WHERE role = 'user';

COMMIT;
