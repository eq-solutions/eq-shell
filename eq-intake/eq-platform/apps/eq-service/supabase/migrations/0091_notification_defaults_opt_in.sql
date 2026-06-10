-- ============================================================
-- Migration 0091: Flip notification defaults to opt-in.
--
-- Decision captured during overnight battle-test 2026-04-30:
--   "Channels OFF, triggers OFF until user opts in (Recommended)
--    Cleanest contract: 'you've enabled nothing, you receive nothing.'
--    New users explicitly turn things on. No surprise notifications,
--    no surprise silence."
--
-- What changes:
--   1. notification_preferences column defaults flip from true → false
--      for the three channel switches (bell_enabled, email_enabled,
--      digest_enabled). Rows that already exist are untouched — this
--      only affects future INSERTs that don't specify a value.
--   2. The get_effective_notification_prefs() fallback values flip to
--      match. That's the value returned when no row exists for the
--      user AND no tenant default row exists. Today there are zero
--      rows in the table across all tenants, so this is the effective
--      production default for everyone until somebody hits Save.
--
-- What doesn't change:
--   - event_type_opt_outs default stays as ARRAY[]::text[] (empty —
--     no opt-outs). The opt-out model is unchanged. When a user turns
--     a channel ON, they receive all event types unless they explicitly
--     mute specific ones via the form's checkboxes.
--   - Existing rows in notification_preferences are NOT touched. If
--     anyone has explicitly saved prefs (they haven't, as of this
--     migration's writing) their state is preserved.
--   - RLS policies, indexes, triggers, comments — all unchanged.
--
-- Backwards compatibility note:
--   The original 0088 migration set defaults to true on the premise
--   that "fresh user wants notifications by default." This 0091 flips
--   to the opposite — fresh user gets nothing until they opt in. That's
--   the right call for a product launching to compliance-minded
--   contractors (less noise, fewer accidental customer-facing emails)
--   but it does mean new tenants need to remember to turn on at least
--   the daily digest if they want anything.
-- ============================================================

-- ── 1. Flip column defaults ─────────────────────────────────────

ALTER TABLE public.notification_preferences
  ALTER COLUMN bell_enabled    SET DEFAULT false,
  ALTER COLUMN email_enabled   SET DEFAULT false,
  ALTER COLUMN digest_enabled  SET DEFAULT false;

-- ── 2. Update the resolver function fallback to match ──────────

CREATE OR REPLACE FUNCTION public.get_effective_notification_prefs(
  p_tenant_id uuid,
  p_user_id   uuid
)
RETURNS TABLE (
  digest_time              time,
  digest_days              text[],
  pre_due_reminder_days    integer[],
  event_type_opt_outs      text[],
  bell_enabled             boolean,
  email_enabled            boolean,
  digest_enabled           boolean,
  timezone                 text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Try the user's own row first.
  RETURN QUERY
    SELECT np.digest_time, np.digest_days, np.pre_due_reminder_days,
           np.event_type_opt_outs, np.bell_enabled, np.email_enabled,
           np.digest_enabled, np.timezone
      FROM public.notification_preferences np
     WHERE np.tenant_id = p_tenant_id
       AND np.user_id   = p_user_id
     LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Fall back to the tenant default (user_id IS NULL).
  RETURN QUERY
    SELECT np.digest_time, np.digest_days, np.pre_due_reminder_days,
           np.event_type_opt_outs, np.bell_enabled, np.email_enabled,
           np.digest_enabled, np.timezone
      FROM public.notification_preferences np
     WHERE np.tenant_id = p_tenant_id
       AND np.user_id   IS NULL
     LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Final fallback — app defaults. Matches the column DEFAULTs above:
  -- channels OFF, no event opt-outs, weekday digest at 7am Sydney.
  -- A user with no saved prefs hears nothing until they opt in.
  RETURN QUERY SELECT
    '07:00'::time,
    ARRAY['mon','tue','wed','thu','fri']::text[],
    ARRAY[14, 7, 1]::integer[],
    ARRAY[]::text[],
    false,
    false,
    false,
    'Australia/Sydney'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_effective_notification_prefs IS
  'Resolves a user''s effective notification preferences via cascade: user row → tenant default → app default. Defaults flipped to opt-in (channels OFF) by migration 0091. Used by cron jobs and triggers when deciding whether/when/how to notify.';
