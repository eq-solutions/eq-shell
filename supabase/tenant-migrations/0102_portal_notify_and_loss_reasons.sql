-- Migration 0102
-- 1. eq_respond_portal_quote v2 — return quote context so the caller can send a notification email
-- 2. eq_list_loss_reasons — loss/cancelled quotes with reasons for Reports win/loss tab

-- ============================================================================
-- 1. eq_respond_portal_quote v2
-- Returns additional fields so quote-accept.ts can send a notification without
-- a second round-trip to the DB. Change is additive (JSONB keys added).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_respond_portal_quote(
  p_token       text,
  p_decision    text,
  p_client_name text DEFAULT NULL,
  p_client_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_data
AS $$
DECLARE
  v_link       app_data.quote_share_links;
  v_quote_num  text;
  v_project    text;
  v_estimator  text;
  v_total      bigint;
BEGIN
  IF p_decision NOT IN ('accept','decline') THEN RAISE EXCEPTION 'invalid_decision'; END IF;

  SELECT * INTO v_link FROM app_data.quote_share_links WHERE token = p_token AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN RAISE EXCEPTION 'link_expired'; END IF;
  IF v_link.accepted_at IS NOT NULL OR v_link.declined_at IS NOT NULL THEN RAISE EXCEPTION 'already_responded'; END IF;

  -- Update the share link record
  UPDATE app_data.quote_share_links
  SET
    accepted_at = CASE WHEN p_decision = 'accept' THEN now() END,
    declined_at = CASE WHEN p_decision = 'decline' THEN now() END,
    client_name = p_client_name,
    client_note = p_client_note
  WHERE link_id = v_link.link_id;

  -- Advance quote to verbal-win on accept
  IF p_decision = 'accept' THEN
    UPDATE app_data.quote
    SET status = 'verbal-win', updated_at = now()
    WHERE quote_id = v_link.quote_id
      AND status NOT IN (
        'verbal-win','won-awaiting-job-no','won-job-created',
        'po-matched','active','complete','ready-to-invoice'
      );
  END IF;

  -- Fetch quote context for notification
  SELECT q.quote_number::text, q.project_name::text, q.estimator_name::text, q.total_cents
  INTO v_quote_num, v_project, v_estimator, v_total
  FROM app_data.quote q
  WHERE q.quote_id = v_link.quote_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'decision',      p_decision,
    'quote_number',  v_quote_num,
    'project_name',  v_project,
    'estimator_name', v_estimator,
    'total_cents',   v_total,
    'client_name',   p_client_name
  );
END;
$$;

-- Permissions unchanged — service_role only
REVOKE ALL ON FUNCTION public.eq_respond_portal_quote(text, text, text, text) FROM PUBLIC;

-- ============================================================================
-- 2. eq_list_loss_reasons
-- Returns lost/cancelled/expired/superseded quotes with their loss_reason
-- for the Reports Win/Loss tab.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_loss_reasons()
RETURNS TABLE(
  quote_id           UUID,
  quote_number       TEXT,
  status             TEXT,
  project_name       TEXT,
  estimator_initials TEXT,
  loss_reason        TEXT,
  total_cents        BIGINT,
  customer_name      TEXT,
  created_at         TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  RETURN QUERY
  SELECT
    q.quote_id,
    q.quote_number::text,
    q.status::text,
    q.project_name::text,
    q.estimator_initials::text,
    q.loss_reason::text,
    q.total_cents,
    c.company_name::text,
    q.created_at
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  WHERE q.tenant_id  = v_tenant_id
    AND q.status     IN ('lost', 'cancelled', 'expired', 'superseded')
    AND q.deleted_at IS NULL
  ORDER BY q.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_loss_reasons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_loss_reasons() TO authenticated;
