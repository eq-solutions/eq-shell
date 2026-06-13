-- Migration: 0087_quote_audit_and_edits
-- Target:    Per-tenant data plane
-- Purpose:   Real, structured quote audit + header-edit upgrades.
--
--   1. app_data.quote_audit — append-only, quote-scoped change log. Captures the
--      important stuff: WHO changed WHAT field FROM what TO what, and WHEN. RLS
--      lets a tenant read its own rows; writes happen ONLY through SECURITY
--      DEFINER RPCs (no INSERT/UPDATE/DELETE grant), so it cannot be tampered
--      with from the client. This is stronger than the legacy Flask audit, which
--      wrote from app code that could be bypassed.
--
--   2. eq__log_quote_audit — internal helper (not exposed to PostgREST).
--
--   3. eq_update_quote v2 — adds p_quote_number (editable anytime, per-tenant
--      uniqueness enforced here since there is no DB unique constraint), removes
--      the draft/submitted-only gate (headers are editable in any status), and
--      writes a field-level diff to quote_audit.
--
--   4. eq_replace_line_items v3 — same signature/behaviour, plus an audit row
--      whenever the line count or money totals change (the pricing signal).
--
--   5. eq_list_quote_audit — read the change history for one quote.
--
-- All idempotent. eq_update_quote changes its signature (new trailing param), so
-- it is DROPped then recreated; the currently-deployed frontend calls it with the
-- prior 15 named args and still resolves (p_quote_number defaults to NULL).

-- ============================================================================
-- 1. quote_audit table
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_data.quote_audit (
  audit_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  quote_id       uuid NOT NULL,
  action         text NOT NULL,            -- 'header' | 'pricing' | 'duplicate' | ...
  changes        jsonb,                    -- {field: {old, new}, ...}
  actor_uuid     uuid,
  actor_initials text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_audit_quote_idx
  ON app_data.quote_audit (tenant_id, quote_id, created_at DESC);

ALTER TABLE app_data.quote_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_audit_tenant_read ON app_data.quote_audit;
CREATE POLICY quote_audit_tenant_read ON app_data.quote_audit
  FOR SELECT TO authenticated
  USING (
    tenant_id = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid
  );

-- Read-only to clients; all writes go through SECURITY DEFINER RPCs.
REVOKE ALL ON app_data.quote_audit FROM anon;
GRANT SELECT ON app_data.quote_audit TO authenticated;

-- ============================================================================
-- 2. eq__log_quote_audit — internal write helper (NOT exposed to PostgREST)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq__log_quote_audit(
  p_quote_id uuid,
  p_action   text,
  p_changes  jsonb DEFAULT NULL,
  p_initials text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_actor     uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  v_actor     := NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;

  INSERT INTO app_data.quote_audit
    (tenant_id, quote_id, action, changes, actor_uuid, actor_initials)
  VALUES
    (v_tenant_id, p_quote_id, p_action, p_changes, v_actor, NULLIF(trim(p_initials), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.eq__log_quote_audit(uuid, text, jsonb, text) FROM PUBLIC, anon;
-- intentionally NOT granted to authenticated: internal helper only.

-- ============================================================================
-- 3. eq_update_quote v2 — editable quote number + audit, any status
-- ============================================================================

DROP FUNCTION IF EXISTS public.eq_update_quote(
  uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.eq_update_quote(
  p_quote_id            uuid,
  p_customer_id         uuid,
  p_site_id             uuid    DEFAULT NULL,
  p_project_name        text    DEFAULT NULL,
  p_estimator_name      text    DEFAULT NULL,
  p_estimator_initials  text    DEFAULT NULL,
  p_scope_of_works      text    DEFAULT NULL,
  p_notes               text    DEFAULT NULL,
  p_validity_days       integer DEFAULT 30,
  p_attn_name           text    DEFAULT NULL,
  p_attn_first_name     text    DEFAULT NULL,
  p_attn_phone          text    DEFAULT NULL,
  p_address             text    DEFAULT NULL,
  p_payment_terms       text    DEFAULT NULL,
  p_clarifications      text    DEFAULT NULL,
  p_quote_number        text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_old        app_data.quote%ROWTYPE;
  v_new_number text;
  v_old_j      jsonb;
  v_new_j      jsonb;
  v_changes    jsonb;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT * INTO v_old
  FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.customers
    WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'customer not found or access denied';
  END IF;

  -- Quote number: keep existing unless an override is supplied. Uniqueness is
  -- enforced here (per tenant) because no DB unique constraint exists.
  v_new_number := COALESCE(NULLIF(trim(p_quote_number), ''), v_old.quote_number);
  IF v_new_number IS DISTINCT FROM v_old.quote_number THEN
    IF EXISTS (
      SELECT 1 FROM app_data.quote
      WHERE tenant_id = v_tenant_id
        AND quote_number = v_new_number
        AND quote_id <> p_quote_id
    ) THEN
      RAISE EXCEPTION 'quote number % is already in use', v_new_number
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  UPDATE app_data.quote
  SET
    customer_id        = p_customer_id,
    site_id            = p_site_id,
    quote_number       = v_new_number,
    project_name       = p_project_name,
    estimator_name     = p_estimator_name,
    estimator_initials = p_estimator_initials,
    scope_of_works     = p_scope_of_works,
    notes              = p_notes,
    clarifications     = p_clarifications,
    validity_days      = p_validity_days,
    expires_at         = now() + (p_validity_days || ' days')::interval,
    attn_name          = p_attn_name,
    attn_first_name    = p_attn_first_name,
    attn_phone         = p_attn_phone,
    address            = p_address,
    payment_terms      = p_payment_terms,
    updated_at         = now()
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  -- Structured audit: diff the editable header fields, old -> new.
  v_old_j := jsonb_build_object(
    'quote_number',       v_old.quote_number,
    'customer_id',        v_old.customer_id,
    'site_id',            v_old.site_id,
    'project_name',       v_old.project_name,
    'estimator_name',     v_old.estimator_name,
    'estimator_initials', v_old.estimator_initials,
    'scope_of_works',     v_old.scope_of_works,
    'notes',              v_old.notes,
    'clarifications',     v_old.clarifications,
    'validity_days',      v_old.validity_days,
    'attn_name',          v_old.attn_name,
    'attn_first_name',    v_old.attn_first_name,
    'attn_phone',         v_old.attn_phone,
    'address',            v_old.address,
    'payment_terms',      v_old.payment_terms
  );
  v_new_j := jsonb_build_object(
    'quote_number',       v_new_number,
    'customer_id',        p_customer_id,
    'site_id',            p_site_id,
    'project_name',       p_project_name,
    'estimator_name',     p_estimator_name,
    'estimator_initials', p_estimator_initials,
    'scope_of_works',     p_scope_of_works,
    'notes',              p_notes,
    'clarifications',     p_clarifications,
    'validity_days',      p_validity_days,
    'attn_name',          p_attn_name,
    'attn_first_name',    p_attn_first_name,
    'attn_phone',         p_attn_phone,
    'address',            p_address,
    'payment_terms',      p_payment_terms
  );

  SELECT jsonb_object_agg(k, jsonb_build_object('old', v_old_j -> k, 'new', v_new_j -> k))
    INTO v_changes
  FROM jsonb_object_keys(v_new_j) AS k
  WHERE (v_old_j -> k) IS DISTINCT FROM (v_new_j -> k);

  IF v_changes IS NOT NULL AND v_changes <> '{}'::jsonb THEN
    PERFORM public.eq__log_quote_audit(p_quote_id, 'header', v_changes, p_estimator_initials);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote(
  uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eq_update_quote(
  uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text, text
) TO authenticated;

-- ============================================================================
-- 4. eq_replace_line_items v3 — recompute + pricing audit
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_replace_line_items(
  p_quote_id   uuid,
  p_line_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_item       jsonb;
  v_line_total bigint;
  v_old_sub    bigint;
  v_old_total  bigint;
  v_old_count  integer;
  v_new_sub    bigint;
  v_new_total  bigint;
  v_new_count  integer;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM app_data.quote
    WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  SELECT subtotal_cents, total_cents INTO v_old_sub, v_old_total
  FROM app_data.quote WHERE quote_id = p_quote_id;
  SELECT count(*) INTO v_old_count
  FROM app_data.quote_line_item WHERE quote_id = p_quote_id;

  DELETE FROM app_data.quote_line_item
  WHERE quote_id = p_quote_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items) LOOP
    v_line_total := (
      (v_item->>'qty_thousandths')::bigint *
      (v_item->>'unit_rate_cents')::bigint
    ) / 1000;

    INSERT INTO app_data.quote_line_item (
      tenant_id, quote_id, line_number,
      description, quantity_thousandths, unit_rate_cents, line_total_cents,
      unit, category, cost_rate_cents
    ) VALUES (
      v_tenant_id,
      p_quote_id,
      (v_item->>'line_number')::integer,
      v_item->>'description',
      (v_item->>'qty_thousandths')::bigint,
      (v_item->>'unit_rate_cents')::bigint,
      v_line_total,
      NULLIF(trim(v_item->>'unit'), ''),
      NULLIF(trim(v_item->>'category'), ''),
      COALESCE((v_item->>'cost_rate_cents')::bigint, 0)
    );
  END LOOP;

  PERFORM public.eq__recompute_quote_totals(p_quote_id);

  SELECT subtotal_cents, total_cents INTO v_new_sub, v_new_total
  FROM app_data.quote WHERE quote_id = p_quote_id;
  SELECT count(*) INTO v_new_count
  FROM app_data.quote_line_item WHERE quote_id = p_quote_id;

  IF v_old_sub IS DISTINCT FROM v_new_sub OR v_old_count IS DISTINCT FROM v_new_count THEN
    PERFORM public.eq__log_quote_audit(
      p_quote_id, 'pricing',
      jsonb_build_object(
        'line_count',     jsonb_build_object('old', v_old_count, 'new', v_new_count),
        'subtotal_cents', jsonb_build_object('old', v_old_sub,   'new', v_new_sub),
        'total_cents',    jsonb_build_object('old', v_old_total, 'new', v_new_total)
      ),
      NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_replace_line_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eq_replace_line_items(uuid, jsonb) TO authenticated;

-- ============================================================================
-- 5. eq_list_quote_audit — read change history for one quote
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_quote_audit(p_quote_id uuid)
RETURNS TABLE (
  audit_id       uuid,
  action         text,
  changes        jsonb,
  actor_initials text,
  created_at     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  RETURN QUERY
  SELECT a.audit_id, a.action, a.changes, a.actor_initials, a.created_at
  FROM app_data.quote_audit a
  WHERE a.quote_id = p_quote_id AND a.tenant_id = v_tenant_id
  ORDER BY a.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_quote_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eq_list_quote_audit(uuid) TO authenticated;
