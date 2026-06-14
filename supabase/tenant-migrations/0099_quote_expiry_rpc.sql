-- Migration 0099: eq_mark_expired_quotes
-- Native replacement for the deprecated Flask /api/cron/check-expired-quotes call.
-- Called daily by the Netlify scheduled function (quotes-expiry-scheduler.ts)
-- via service_role against each tenant's Supabase DB.
--
-- Updates all quotes whose validity window has passed and are still in an
-- open-but-unresolved status to 'expired'. Returns the count of rows changed.

CREATE OR REPLACE FUNCTION public.eq_mark_expired_quotes()
RETURNS TABLE(expired_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE app_data.quote
  SET
    status     = 'expired',
    updated_at = now()
  WHERE status IN ('submitted', 'client-reviewing')
    AND expires_at IS NOT NULL
    AND expires_at < now()
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_mark_expired_quotes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_mark_expired_quotes() TO service_role;
