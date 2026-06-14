-- Quote share links for the client portal.
-- A share link contains a random token that lets an unauthenticated client
-- view, accept, or decline a quote via the portal.

CREATE TABLE IF NOT EXISTS app_data.quote_share_links (
  link_id        uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  quote_id       uuid        NOT NULL,
  token          text        NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  is_active      boolean     NOT NULL DEFAULT true,
  expires_at     timestamptz,
  opened_at      timestamptz,
  accepted_at    timestamptz,
  declined_at    timestamptz,
  client_name    text,
  client_note    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  CONSTRAINT quote_share_links_pkey    PRIMARY KEY (link_id),
  CONSTRAINT quote_share_links_token   UNIQUE (token),
  CONSTRAINT quote_share_links_quote   FOREIGN KEY (quote_id)
    REFERENCES app_data.quote(quote_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS quote_share_links_tenant_idx
  ON app_data.quote_share_links (tenant_id, quote_id);

GRANT ALL ON app_data.quote_share_links TO service_role;
ALTER TABLE app_data.quote_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_share_links_tenant_isolation ON app_data.quote_share_links;
CREATE POLICY quote_share_links_tenant_isolation ON app_data.quote_share_links
  FOR ALL TO authenticated
  USING      (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid)
  WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid);

-- RPC: create or refresh a share link for a quote
CREATE OR REPLACE FUNCTION public.eq_create_share_link(
  p_quote_id   uuid,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_data
AS $$
DECLARE
  v_tenant_id uuid := ((auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid;
  v_link_id   uuid;
  v_token     text;
BEGIN
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'tenant_id missing from JWT'; END IF;

  -- Ensure quote belongs to this tenant
  IF NOT EXISTS (
    SELECT 1 FROM app_data.quote
    WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  -- Deactivate any existing active links for this quote
  UPDATE app_data.quote_share_links
  SET is_active = false
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id AND is_active = true;

  -- Create new link
  INSERT INTO app_data.quote_share_links (tenant_id, quote_id, expires_at, created_by)
  VALUES (v_tenant_id, p_quote_id, p_expires_at, auth.uid())
  RETURNING link_id, token INTO v_link_id, v_token;

  RETURN jsonb_build_object('link_id', v_link_id, 'token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_create_share_link FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_create_share_link TO authenticated;

-- RPC: read portal data by token (SERVICE_ROLE only — called from Netlify function)
CREATE OR REPLACE FUNCTION public.eq_get_portal_quote(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_data
AS $$
DECLARE
  v_link   app_data.quote_share_links;
  v_quote  app_data.quote;
  v_cust   record;
  v_lines  jsonb;
BEGIN
  SELECT * INTO v_link
  FROM app_data.quote_share_links
  WHERE token = p_token AND is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now()
  THEN RAISE EXCEPTION 'link_expired'; END IF;

  -- Record first open
  IF v_link.opened_at IS NULL THEN
    UPDATE app_data.quote_share_links SET opened_at = now() WHERE link_id = v_link.link_id;
  END IF;

  SELECT * INTO v_quote FROM app_data.quote WHERE quote_id = v_link.quote_id;

  SELECT company_name, abn, primary_phone, email INTO v_cust
  FROM app_data.customers WHERE customer_id = v_quote.customer_id;

  SELECT jsonb_agg(jsonb_build_object(
    'description', li.description,
    'quantity',    li.quantity_thousandths::numeric / 1000,
    'unit',        li.unit,
    'unit_rate',   li.unit_rate_cents::numeric / 100,
    'line_total',  li.line_total_cents::numeric / 100,
    'category',    li.category
  ) ORDER BY li.line_number) INTO v_lines
  FROM app_data.quote_line_item li
  WHERE li.quote_id = v_link.quote_id;

  RETURN jsonb_build_object(
    'link_id',       v_link.link_id,
    'token',         v_link.token,
    'accepted_at',   v_link.accepted_at,
    'declined_at',   v_link.declined_at,
    'quote', jsonb_build_object(
      'quote_id',        v_quote.quote_id,
      'quote_number',    v_quote.quote_number,
      'project_name',    v_quote.project_name,
      'scope_of_works',  v_quote.scope_of_works,
      'status',          v_quote.status,
      'subtotal_cents',  v_quote.subtotal_cents,
      'gst_cents',       v_quote.gst_cents,
      'total_cents',     v_quote.total_cents,
      'sent_at',         v_quote.sent_at,
      'expires_at',      v_quote.expires_at,
      'estimator_name',  v_quote.estimator_name,
      'estimator_initials', v_quote.estimator_initials,
      'attn_name',       v_quote.attn_name,
      'attn_first_name', v_quote.attn_first_name,
      'line_items',      COALESCE(v_lines, '[]'::jsonb)
    ),
    'customer', jsonb_build_object(
      'company_name', v_cust.company_name,
      'abn',          v_cust.abn,
      'phone',        v_cust.primary_phone,
      'email',        v_cust.email
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eq_get_portal_quote FROM PUBLIC;
-- No grant to authenticated — called by Netlify function using service_role

-- RPC: accept or decline via token (SERVICE_ROLE only)
CREATE OR REPLACE FUNCTION public.eq_respond_portal_quote(
  p_token      text,
  p_decision   text,   -- 'accept' or 'decline'
  p_client_name text  DEFAULT NULL,
  p_client_note text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_data
AS $$
DECLARE
  v_link  app_data.quote_share_links;
BEGIN
  IF p_decision NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'decision must be accept or decline';
  END IF;

  SELECT * INTO v_link
  FROM app_data.quote_share_links
  WHERE token = p_token AND is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now()
  THEN RAISE EXCEPTION 'link_expired'; END IF;
  IF v_link.accepted_at IS NOT NULL OR v_link.declined_at IS NOT NULL
  THEN RAISE EXCEPTION 'already_responded'; END IF;

  UPDATE app_data.quote_share_links
  SET
    accepted_at  = CASE WHEN p_decision = 'accept' THEN now() END,
    declined_at  = CASE WHEN p_decision = 'decline' THEN now() END,
    client_name  = p_client_name,
    client_note  = p_client_note
  WHERE link_id = v_link.link_id;

  -- Advance quote status on accept
  IF p_decision = 'accept' THEN
    UPDATE app_data.quote
    SET status     = 'verbal-win',
        updated_at = now()
    WHERE quote_id = v_link.quote_id
      AND status NOT IN ('verbal-win','won-awaiting-job-no','won-job-created',
                         'po-matched','active','complete','ready-to-invoice');
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_respond_portal_quote FROM PUBLIC;
-- No grant to authenticated — called by Netlify function using service_role
