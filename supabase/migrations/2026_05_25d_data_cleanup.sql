-- Migration: 2026_05_25d_data_cleanup
-- Target:    SHARED eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Data cleanup following Phase 2 consolidation.
--
-- 1. Remove tender_pipeline module entitlement.
--    The tender-pipeline React module was removed 2026-05-23 (CLAUDE.md).
--    The entitlement row was left behind; removing it stops it appearing
--    in session entitlements and prevents confusion if a key with that
--    name is ever re-used for a different module.
--
-- 2. Promote royce@eq.solutions to manager + platform_admin.
--    The shell_control.users row had role=employee, is_platform_admin=false.
--    Also backfills auth.users.raw_app_meta_data so Supabase Auth JWTs
--    are consistent (the upgraded auth hook will maintain this going
--    forward on every sign-in — see 2026_05_25c_auth_hook_full_claims).
--
-- Applied via MCP at 2026-05-25. Re-running is safe (idempotent UPDATEs,
-- DELETE of non-existent row is a no-op).

-- 1. Remove stale tender_pipeline entitlement
DELETE FROM shell_control.module_entitlements
WHERE module = 'tender_pipeline';

-- 2a. Promote in shell_control (source of truth for verify-shell-session)
UPDATE shell_control.users
SET role             = 'manager'::eq_role,
    is_platform_admin = true
WHERE email = 'royce@eq.solutions';

-- 2b. Backfill auth.users so next Supabase-native sign-in gets correct claims
--     before the hook fires (belt-and-braces; hook now stamps these anyway).
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data
  || '{"eq_role": "manager", "is_platform_admin": true}'::jsonb
WHERE email = 'royce@eq.solutions';
