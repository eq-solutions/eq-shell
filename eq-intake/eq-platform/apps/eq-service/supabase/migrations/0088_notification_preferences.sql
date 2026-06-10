-- ============================================================
-- Migration 0088: Phase A foundation for the notifications/digests/
-- reminders build (per design doc 2026-04-29).
--
-- Three pieces:
--   1. Enable pg_cron + pg_net extensions (Supabase). pg_cron schedules
--      SQL functions; pg_net is the http_post helper used by the cron
--      jobs to call our Next.js API route.
--   2. notification_preferences — per-user, per-tenant customisation.
--      Outlook-invite-style: user picks digest time, days, pre-due
--      reminder offsets, and which event types they want (opt-out).
--      Tenant-level defaults live as rows where user_id IS NULL.
--   3. customer_notification_preferences — per-customer-contact
--      customisation for the commercial-tier customer-facing emails.
--      Keyed by customer_contacts.id (not auth.users) so contacts who
--      haven't logged into the portal still get emails.
--
-- RLS: users see/update their own prefs; admins manage tenant defaults
-- and customer prefs. Reads use COALESCE(user pref → tenant default →
-- app default) — falling back at read time avoids needing a row per
-- user up front.
-- ============================================================

-- ── 1. Extensions ───────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- The pg_cron schema by default is `cron`. pg_cron jobs created by the
-- service role call SECURITY DEFINER functions in `public`.

-- ── 2. notification_preferences ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Outlook-invite-style customisation. All have sensible defaults.
  -- Time + days control when the daily digest arrives in the inbox.
  -- pre_due_reminder_days controls the X-days-before-due reminder
  -- cadence. event_type_opt_outs lets the user mute specific kinds of
  -- notification (e.g. they don't care about variation status changes).
  digest_time              time         NOT NULL DEFAULT '07:00',
  digest_days              text[]       NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri']::text[],
  pre_due_reminder_days    integer[]    NOT NULL DEFAULT ARRAY[14, 7, 1]::integer[],
  event_type_opt_outs      text[]       NOT NULL DEFAULT ARRAY[]::text[],

  -- Channel master switches. If email_enabled is false, no scheduled
  -- emails go out (real-time bell still fires unless bell_enabled is
  -- also off). digest_enabled controls just the morning digest, leaves
  -- pre-due reminders alone — separate concept.
  bell_enabled       boolean   NOT NULL DEFAULT true,
  email_enabled      boolean   NOT NULL DEFAULT true,
  digest_enabled     boolean   NOT NULL DEFAULT true,

  -- Tenant timezone for cadence calculations. Default Sydney; users in
  -- Perth or Brisbane can override their personal pref. Stored as IANA
  -- name so Postgres can convert with AT TIME ZONE.
  timezone           text      NOT NULL DEFAULT 'Australia/Sydney',

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Per-user uniqueness (when user_id is set). Tenant defaults are the
  -- rows where user_id IS NULL — at most one per tenant.
  CONSTRAINT notification_preferences_user_unique
    UNIQUE NULLS NOT DISTINCT (tenant_id, user_id)
);

DROP TRIGGER IF EXISTS notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS notification_preferences_tenant_idx
  ON public.notification_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS notification_preferences_user_idx
  ON public.notification_preferences(user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Read: users see their own row OR the tenant default (user_id IS NULL).
-- Admins see everything in their tenant.
CREATE POLICY notification_preferences_select ON public.notification_preferences
  FOR SELECT USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (
      user_id = auth.uid()
      OR user_id IS NULL
      OR public.get_user_role(tenant_id) IN ('super_admin', 'admin')
    )
  );

-- Insert: users insert their own row; admins insert tenant defaults.
CREATE POLICY notification_preferences_insert ON public.notification_preferences
  FOR INSERT WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (
      user_id = auth.uid()
      OR (user_id IS NULL AND public.get_user_role(tenant_id) IN ('super_admin', 'admin'))
    )
  );

-- Update: same shape — own row or tenant default (admin only for the latter).
CREATE POLICY notification_preferences_update ON public.notification_preferences
  FOR UPDATE USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (
      user_id = auth.uid()
      OR (user_id IS NULL AND public.get_user_role(tenant_id) IN ('super_admin', 'admin'))
    )
  );

-- Delete: admin only — preferences are state worth a sanity check.
CREATE POLICY notification_preferences_delete ON public.notification_preferences
  FOR DELETE USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

COMMENT ON TABLE public.notification_preferences IS
  'Per-user (or per-tenant default when user_id IS NULL) notification preferences. Outlook-invite-style: digest time, days, pre-due reminder offsets, per-event-type opt-out, channel master switches, timezone.';

-- ── 3. customer_notification_preferences ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.customer_notification_preferences (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_contact_id   uuid        NOT NULL REFERENCES public.customer_contacts(id) ON DELETE CASCADE,

  -- What kinds of customer-facing emails this contact wants. Defaults are
  -- conservative: monthly summary on, ad-hoc events off. The customer's
  -- account manager can override before going live.
  receive_monthly_summary    boolean   NOT NULL DEFAULT true,
  receive_upcoming_visit     boolean   NOT NULL DEFAULT true,
  receive_critical_defect    boolean   NOT NULL DEFAULT false,
  receive_variation_approved boolean   NOT NULL DEFAULT false,
  receive_report_delivery    boolean   NOT NULL DEFAULT true,

  -- Cadence — customers don't get a daily digest, but their monthly
  -- summary fires on the day-of-month they pick (default 1st).
  monthly_summary_day        integer   NOT NULL DEFAULT 1
    CHECK (monthly_summary_day BETWEEN 1 AND 28),

  -- The contact may have given consent at a specific time; record it
  -- for compliance defensibility.
  consent_given_at           timestamptz,
  consent_given_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_notification_preferences_contact_unique
    UNIQUE (customer_contact_id)
);

DROP TRIGGER IF EXISTS customer_notification_preferences_updated_at
  ON public.customer_notification_preferences;
CREATE TRIGGER customer_notification_preferences_updated_at
  BEFORE UPDATE ON public.customer_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS customer_notification_preferences_tenant_idx
  ON public.customer_notification_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS customer_notification_preferences_contact_idx
  ON public.customer_notification_preferences(customer_contact_id);

ALTER TABLE public.customer_notification_preferences ENABLE ROW LEVEL SECURITY;

-- Read + write: writer-or-above on the tenant. The customer themselves
-- doesn't directly edit this row — they tell their account manager,
-- who edits on their behalf.
CREATE POLICY customer_notification_preferences_select
  ON public.customer_notification_preferences
  FOR SELECT USING (
    tenant_id = ANY (public.get_user_tenant_ids())
  );

CREATE POLICY customer_notification_preferences_insert
  ON public.customer_notification_preferences
  FOR INSERT WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY customer_notification_preferences_update
  ON public.customer_notification_preferences
  FOR UPDATE USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY customer_notification_preferences_delete
  ON public.customer_notification_preferences
  FOR DELETE USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

COMMENT ON TABLE public.customer_notification_preferences IS
  'Per-customer-contact opt-in flags for commercial-tier customer-facing emails (monthly summary, upcoming visit, critical defect, etc.). Edited by tenant staff, not by the customer themselves.';

-- ── 4. Helper to resolve effective preference for a user ──────────────
--
-- Reads the user's own row, falls back to tenant default, falls back to
-- app default. SECURITY DEFINER so triggers + cron jobs can call it
-- without RLS round-tripping.

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

  -- Final fallback — app defaults. Matches the column DEFAULTs above.
  RETURN QUERY SELECT
    '07:00'::time,
    ARRAY['mon','tue','wed','thu','fri']::text[],
    ARRAY[14, 7, 1]::integer[],
    ARRAY[]::text[],
    true,
    true,
    true,
    'Australia/Sydney'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_effective_notification_prefs IS
  'Resolves a user''s effective notification preferences via cascade: user row → tenant default → app default. Used by cron jobs and triggers when deciding whether/when/how to notify.';
