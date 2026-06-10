-- ============================================================
-- Migration 0089: pg_cron job that fires the unified notification
-- dispatcher every 15 minutes.
--
-- The dispatcher endpoint (/api/cron/dispatch-notifications) handles
-- four feature dispatches in one request (supervisor digest, pre-due
-- reminders, customer monthly summary, customer upcoming-visit). Per-
-- user prefs decide who actually receives anything in any given run.
--
-- Why every 15 minutes?
--   Outlook-invite-style customisation lets users pick a digest_time
--   like '07:00' or '07:30'. Running every 15 min catches the four
--   :00 / :15 / :30 / :45 slots. Per-user matching logic in the
--   endpoint filters down to "is now this user's slot in their tz?".
--
-- Auth between pg_cron and the API:
--   pg_cron uses pg_net.http_post to POST with an Authorization header
--   carrying the CRON_SECRET. The secret is stored in the DB-side
--   `vault.secrets` table (Supabase Vault — encrypted at rest). The
--   app_url is in `app.settings` (a regular key/value table created
--   here for non-secret config).
--
-- Operations:
--   - Run `SELECT cron.unschedule('notifications-dispatcher')` to
--     pause the scheduler temporarily.
--   - Inspect runs: SELECT * FROM cron.job_run_details WHERE jobid =
--     (SELECT jobid FROM cron.job WHERE jobname='notifications-dispatcher')
--     ORDER BY start_time DESC LIMIT 20.
-- ============================================================

-- ── 1. App settings table (non-secret config like app_url) ────────────
--
-- Lives at public.app_settings rather than the system catalog so that
-- migrations are reproducible across environments without manual
-- ALTER SYSTEM SET steps.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key   text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_admin_all ON public.app_settings;
CREATE POLICY app_settings_admin_all ON public.app_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.user_id = auth.uid()
         AND tm.is_active = true
         AND tm.role IN ('super_admin')
    )
  );

-- Seed the production app_url. Operators flip per-env in Supabase
-- Studio → Database → Tables → app_settings.
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'app_url',
  'https://eq-solves-service.netlify.app',
  'Public URL the cron job hits for notification dispatch. Override per environment (dev/staging/prod).'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Helper that pg_cron calls ───────────────────────────────────────
--
-- Reads app_url + cron_secret, fires pg_net.http_post. Wrapped as a
-- function so cron.schedule has a clean one-line invocation.

CREATE OR REPLACE FUNCTION public.dispatch_scheduled_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_app_url    text;
  v_secret     text;
  v_request_id bigint;
BEGIN
  SELECT value INTO v_app_url FROM public.app_settings WHERE key = 'app_url';
  IF v_app_url IS NULL THEN
    RAISE NOTICE 'dispatch_scheduled_notifications: app_url not set in app_settings; skipping';
    RETURN;
  END IF;

  -- The cron_secret comes from Supabase Vault (encrypted at rest). If the
  -- secret isn't set yet we silently skip — operators set it once after
  -- deploy via:
  --   SELECT vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'cron_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'dispatch_scheduled_notifications: cron_secret not set in vault; skipping';
    RETURN;
  END IF;

  -- Fire and forget. pg_net is async — the request_id can be used to
  -- inspect status in net._http_response if we ever want to.
  SELECT net.http_post(
    url := v_app_url || '/api/cron/dispatch-notifications',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispatch_scheduled_notifications()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.dispatch_scheduled_notifications IS
  'Called by pg_cron every 15 minutes. Reads app_url + cron_secret, fires the /api/cron/dispatch-notifications endpoint. Silently no-ops if either config is missing.';

-- ── 3. Schedule the cron job ───────────────────────────────────────────

-- Unschedule first so re-running this migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('notifications-dispatcher');
EXCEPTION WHEN OTHERS THEN
  -- Job didn't exist — fine.
  NULL;
END $$;

-- Cron expression: every 15 minutes (00, 15, 30, 45 of every hour).
-- pg_cron uses standard cron syntax (5 fields: min hour dom month dow).
SELECT cron.schedule(
  'notifications-dispatcher',
  '*/15 * * * *',
  $cron$SELECT public.dispatch_scheduled_notifications();$cron$
);

COMMENT ON EXTENSION pg_cron IS
  'Scheduled by 0089 — runs notifications-dispatcher every 15 minutes. See public.dispatch_scheduled_notifications().';
