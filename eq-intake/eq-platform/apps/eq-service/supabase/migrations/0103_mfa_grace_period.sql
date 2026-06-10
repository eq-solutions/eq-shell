-- Migration 0103: profiles.mfa_grace_started_at — N-day MFA enrollment grace.
--
-- Background
-- ----------
-- UX audit PR #149 §B.1 / §5.4 (locked 2026-05-19): mandatory MFA enrollment
-- at first sign-in was blocking technicians on-site in the field (no signal
-- in basement plant rooms, older techs without TOTP apps already installed,
-- supervisor watching while they fumble with QR codes). Royce locked the
-- decision: 14-day grace period for ALL roles. Banner reminder during the
-- window; hard-gate to /auth/enroll-mfa after the window.
--
-- This migration adds the timestamp column and starts the timer for everyone
-- — existing users get a fresh 14 days from migration apply, new users get
-- their timer stamped on insert via the column DEFAULT.
--
-- The proxy.ts middleware reads this column and decides whether to enforce
-- the AAL2 redirect. Grace logic lives entirely in app code; no database
-- function handles the time math.
--
-- Idempotent — `ADD COLUMN IF NOT EXISTS` + a guarded UPDATE keep re-runs
-- safe.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_grace_started_at timestamptz DEFAULT now();

-- Backfill rows that pre-date the DEFAULT (existing users).
UPDATE public.profiles
  SET mfa_grace_started_at = now()
  WHERE mfa_grace_started_at IS NULL;

COMMENT ON COLUMN public.profiles.mfa_grace_started_at IS
  'Timestamp the MFA-enrollment grace window started for this user. Grace = 14 days from this column. Stamped at profile creation via DEFAULT now(). proxy.ts skips the AAL2 enroll-redirect while (now - mfa_grace_started_at) < interval ''14 days''. After 14 days the redirect resumes. Demo users bypass MFA entirely and are unaffected.';
