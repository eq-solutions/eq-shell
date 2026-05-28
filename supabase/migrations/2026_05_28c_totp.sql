-- Migration 2026_05_28c: TOTP enrollment columns on shell_control.users
--
-- Adds opt-in TOTP 2FA to Shell's PIN-based auth.
--
-- Design:
--   totp_secret        — base32-encoded 20-byte HMAC-SHA1 seed.
--                        Stored immediately when the user starts enrollment;
--                        cleared (set NULL) if they abandon without confirming.
--                        Non-null does NOT mean enrolled — check totp_enrolled_at.
--
--   totp_enrolled_at   — set by confirm-totp.ts when the user verifies
--                        their first code. NULL = not enrolled.
--                        If non-null, shell-login.ts gates the session
--                        cookie behind a TOTP challenge.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS guards re-runs.

ALTER TABLE shell_control.users
  ADD COLUMN IF NOT EXISTS totp_secret        text,
  ADD COLUMN IF NOT EXISTS totp_enrolled_at   timestamptz;

COMMENT ON COLUMN shell_control.users.totp_secret IS
  'Base32-encoded 20-byte TOTP secret (RFC 6238 / HOTP SHA-1). '
  'Present once enrollment starts; cleared if abandoned. '
  'Non-null does NOT imply enrolled — see totp_enrolled_at.';

COMMENT ON COLUMN shell_control.users.totp_enrolled_at IS
  'Timestamp the user confirmed their first TOTP code. '
  'NULL = not enrolled. Non-null = enrolled; shell-login challenges TOTP on every login.';
