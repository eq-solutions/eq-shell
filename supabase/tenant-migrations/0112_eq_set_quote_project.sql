-- Migration 0112
-- eq_set_quote_project — update project name and estimator inline from the
-- detail panel without requiring a full quote edit round-trip.
-- Passes NULL for any arg to leave that field unchanged (COALESCE guard).

BEGIN;

CREATE OR REPLACE FUNCTION public.eq_set_quote_project(
  p_quote_id           uuid,
  p_project_name       text    DEFAULT NULL,
  p_estimator_name     text    DEFAULT NULL,
  p_estimator_initials text    DEFAULT NULL,
  p_initials           text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  UPDATE app_data.quote
  SET project_name       = COALESCE(p_project_name,       project_name),
      estimator_name     = COALESCE(p_estimator_name,     estimator_name),
      estimator_initials = COALESCE(p_estimator_initials, estimator_initials),
      updated_at         = now()
  WHERE quote_id  = p_quote_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  PERFORM public.eq__log_quote_audit(
    p_quote_id,
    'project',
    jsonb_build_object(
      'project_name',       p_project_name,
      'estimator_name',     p_estimator_name,
      'estimator_initials', p_estimator_initials
    ),
    p_initials
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_set_quote_project(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_set_quote_project(uuid, text, text, text, text) TO authenticated, service_role;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0112_eq_set_quote_project', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
