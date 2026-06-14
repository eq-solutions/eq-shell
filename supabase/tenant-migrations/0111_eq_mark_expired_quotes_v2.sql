-- Migration 0111
-- eq_mark_expired_quotes v2
--   • Adds 'on-hold' to the status set (on-hold quotes also auto-expire)
--   • Logs one quote_audit row per expired quote so the Change History
--     panel shows the auto-expiry event with actor_initials='SYS'
--
-- Replaces the simpler batch-UPDATE in 0099 with a row-by-row loop so that
-- per-row audit rows can be inserted without a separate correlated query.
-- The tenant connection is already scoped by the caller (service_role on
-- the tenant's own Supabase project) so no p_tenant_id arg is needed.

BEGIN;

DROP FUNCTION IF EXISTS public.eq_mark_expired_quotes();

CREATE OR REPLACE FUNCTION public.eq_mark_expired_quotes()
RETURNS TABLE(expired_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_row   RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT quote_id, tenant_id
    FROM   app_data.quote
    WHERE  status IN ('submitted', 'client-reviewing', 'on-hold')
      AND  expires_at IS NOT NULL
      AND  expires_at < now()
      AND  deleted_at IS NULL
  LOOP
    UPDATE app_data.quote
    SET    status     = 'expired',
           updated_at = now()
    WHERE  quote_id  = v_row.quote_id
      AND  tenant_id = v_row.tenant_id;

    INSERT INTO app_data.quote_audit
      (tenant_id, quote_id, action, changes, actor_uuid, actor_initials)
    VALUES
      (v_row.tenant_id, v_row.quote_id,
       'expired',
       jsonb_build_object('auto', true),
       NULL, 'SYS');

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_mark_expired_quotes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_mark_expired_quotes() TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0111_eq_mark_expired_quotes_v2', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
