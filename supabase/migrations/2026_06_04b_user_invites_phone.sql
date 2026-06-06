-- 2026_06_04b_user_invites_phone.sql
-- Control-plane migration (jvknxcmbtrfnxfrwfimn shell_control schema).
--
-- Phase 2 of the login/onboarding build: capture an optional mobile number
-- at invite time so a newly-onboarded user can use the Mobile (phone-OTP)
-- sign-in door from day one. accept-invite copies this onto the new
-- shell_control.users row (users.phone already exists and is UNIQUE where
-- not null), so the worker's identity stays a single row keyed on email
-- with phone linked.
--
-- Additive + nullable: existing open invites are unaffected (phone stays
-- NULL, so the user simply has no Mobile door until a number is added).
-- Idempotent via IF NOT EXISTS.
--
-- Applied 2026-06-04 via Supabase MCP (migration name: user_invites_phone).

ALTER TABLE shell_control.user_invites
  ADD COLUMN IF NOT EXISTS phone text;
