-- Migration: 0092_quote_lifecycle
-- Target:    Per-tenant data plane
-- Purpose:   EQ Ops parity sprint — Wave 1 (quote lifecycle).
--
--   1. Add two statuses the Flask app has but EQ Ops lacked: 'client-reviewing'
--      and 'on-hold' (quote_status_check widened).
--   2. Soft-delete: quote.deleted_at + eq_trash_quote / eq_restore_quote, and
--      eq_list_quotes now hides trashed rows; eq_list_trashed_quotes lists them.
--   3. eq_update_quote_status v4: also emit canonical events quote.sent (on first
--      → submitted) and quote.declined (on → lost), alongside the existing
--      quote.accepted (on → verbal-win).
--   4. eq_bulk_update_quote_status: apply one status to many quotes (loops the
--      single-quote RPC so history/notes/events stay in one place).
--
-- Numbered 0092 to sit clear of the un-merged rename PR #353 (0089–0091).
-- All idempotent (DROP+ADD constraint / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE).

-- ============================================================================
-- 1. Status set — add client-reviewing + on-hold
-- ============================================================================

ALTER TABLE app_data.quote DROP CONSTRAINT IF EXISTS quote_status_check;
ALTER TABLE app_data.quote ADD CONSTRAINT quote_status_check
  CHECK (status = ANY (ARRAY[
    'draft','submitted','client-reviewing','verbal-win','won-awaiting-job-no',
    'won-job-created','po-matched','active','complete','ready-to-invoice',
    'on-hold','lost','cancelled','expired','superseded'
  ]));

-- quote_status_history carries its OWN to/from status whitelists — widen both,
-- or the status RPC fails to log a transition into the new statuses.
ALTER TABLE app_data.quote_status_history DROP CONSTRAINT IF EXISTS qsh_to_status_check;
ALTER TABLE app_data.quote_status_history ADD CONSTRAINT qsh_to_status_check
  CHECK (to_status = ANY (ARRAY[
    'draft','submitted','client-reviewing','verbal-win','won-awaiting-job-no',
    'won-job-created','po-matched','active','complete','ready-to-invoice',
    'on-hold','lost','cancelled','expired','superseded'
  ]));
ALTER TABLE app_data.quote_status_history DROP CONSTRAINT IF EXISTS qsh_from_status_check;
ALTER TABLE app_data.quote_status_history ADD CONSTRAINT qsh_from_status_check
  CHECK (from_status IS NULL OR from_status = ANY (ARRAY[
    'draft','submitted','client-reviewing','verbal-win','won-awaiting-job-no',
    'won-job-created','po-matched','active','complete','ready-to-invoice',
    'on-hold','lost','cancelled','expired','superseded'
  ]));

-- ============================================================================
-- 2. Soft-delete column
-- ============================================================================

ALTER TABLE app_data.quote ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS quote_live_idx
  ON app_data.quote (tenant_id) WHERE deleted_at IS NULL;

-- ============================================================================
-- 3. eq_update_quote_status v4 — sent + declined events
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_update_quote_status(
  p_quote_id   uuid,
  p_new_status text,
  p_note       text DEFAULT NULL,
  p_initials   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id     uuid;
  v_old_status    text;
  v_quote_number  text;
  v_customer_id   uuid;
  v_site_id       uuid;
  v_customer_name text;
  v_note_body     text;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT q.status, q.quote_number, q.customer_id, q.site_id
    INTO v_old_status, v_quote_number, v_customer_id, v_site_id
  FROM app_data.quote q
  WHERE q.quote_id = p_quote_id AND q.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  UPDATE app_data.quote
  SET
    status           = p_new_status,
    updated_at       = now(),
    sent_at          = CASE WHEN p_new_status = 'submitted' AND sent_at IS NULL THEN now() ELSE sent_at END,
    sent_by_initials = CASE WHEN p_new_status = 'submitted' AND sent_by_initials IS NULL THEN p_initials ELSE sent_by_initials END,
    loss_reason      = CASE WHEN p_new_status = 'lost' THEN COALESCE(p_note, loss_reason) ELSE loss_reason END
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  INSERT INTO app_data.quote_status_history
    (tenant_id, quote_id, from_status, to_status, changed_by_initials, reason, changed_at)
  VALUES
    (v_tenant_id, p_quote_id, v_old_status, p_new_status, p_initials, p_note, now());

  v_note_body := v_old_status || ' → ' || p_new_status
    || CASE WHEN p_note IS NOT NULL AND p_note <> '' THEN ': ' || p_note ELSE '' END;

  INSERT INTO app_data.job_notes
    (tenant_id, quote_id, body, note_type, created_by_initials)
  VALUES
    (v_tenant_id, p_quote_id, v_note_body, 'status-change', p_initials);

  -- Canonical events. Look up the customer name once for all event payloads.
  IF (p_new_status = 'verbal-win' AND v_old_status IS DISTINCT FROM 'verbal-win')
     OR (p_new_status = 'submitted' AND v_old_status IS DISTINCT FROM 'submitted')
     OR (p_new_status = 'lost' AND v_old_status IS DISTINCT FROM 'lost') THEN

    SELECT c.company_name INTO v_customer_name
    FROM app_data.customers c
    WHERE c.customer_id = v_customer_id AND c.tenant_id = v_tenant_id;

    INSERT INTO app_data.canonical_events (tenant_id, app_source, event, payload, occurred_at)
    SELECT v_tenant_id, 'quotes',
      CASE
        WHEN p_new_status = 'verbal-win' THEN 'quote.accepted'
        WHEN p_new_status = 'submitted'  THEN 'quote.sent'
        ELSE 'quote.declined'
      END,
      jsonb_build_object(
        'quote_id',      p_quote_id,
        'reference',     v_quote_number,
        'customer_name', v_customer_name,
        'customer_id',   v_customer_id,
        'site_id',       v_site_id,
        'reason',        p_note
      ),
      now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) TO authenticated;

-- ============================================================================
-- 4. Bulk status — loops the single-quote RPC (one source of truth)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_bulk_update_quote_status(
  p_quote_ids uuid[],
  p_new_status text,
  p_initials   text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_id    uuid;
  v_count integer := 0;
BEGIN
  FOREACH v_id IN ARRAY p_quote_ids LOOP
    PERFORM public.eq_update_quote_status(v_id, p_new_status, NULL, p_initials);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_bulk_update_quote_status(uuid[], text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_bulk_update_quote_status(uuid[], text, text) TO authenticated;

-- ============================================================================
-- 5. Trash / restore
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_trash_quote(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  UPDATE app_data.quote
  SET deleted_at = now(), updated_at = now()
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found, access denied, or already trashed';
  END IF;
  PERFORM public.eq__log_quote_audit(p_quote_id, 'trashed', NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_trash_quote(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_trash_quote(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.eq_restore_quote(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  UPDATE app_data.quote
  SET deleted_at = NULL, updated_at = now()
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found, access denied, or not trashed';
  END IF;
  PERFORM public.eq__log_quote_audit(p_quote_id, 'restored', NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_restore_quote(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_restore_quote(uuid) TO authenticated;

-- ============================================================================
-- 6. eq_list_quotes v2 — hide trashed rows
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_quotes(p_status text DEFAULT NULL, p_search text DEFAULT NULL)
RETURNS TABLE (
  quote_id uuid, quote_number text, status text, project_name text,
  estimator_name text, estimator_initials text, subtotal_cents bigint,
  gst_cents bigint, total_cents bigint, margin_pct numeric,
  sent_at timestamptz, expires_at timestamptz, workbench_job_no text,
  po_number text, created_at timestamptz, customer_name text,
  site_name text, site_code text, line_item_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT
    q.quote_id, q.quote_number::text, q.status::text, q.project_name::text,
    q.estimator_name::text, q.estimator_initials::text, q.subtotal_cents,
    q.gst_cents, q.total_cents, q.margin_pct, q.sent_at, q.expires_at,
    q.workbench_job_no::text, q.po_number::text, q.created_at,
    c.company_name::text, s.name::text, s.code::text,
    (SELECT count(*)::bigint FROM app_data.quote_line_item qli WHERE qli.quote_id = q.quote_id)
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  LEFT JOIN app_data.sites     s ON s.site_id     = q.site_id
  WHERE q.tenant_id = v_tenant_id
    AND q.deleted_at IS NULL
    AND (p_status IS NULL OR q.status = p_status)
    AND (p_search IS NULL OR (
          q.quote_number ILIKE '%' || p_search || '%'
       OR q.project_name ILIKE '%' || p_search || '%'
       OR c.company_name ILIKE '%' || p_search || '%'))
  ORDER BY q.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_quotes(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_list_quotes(text, text) TO authenticated;

-- ============================================================================
-- 7. eq_list_trashed_quotes — the Trash view
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_trashed_quotes()
RETURNS TABLE (
  quote_id uuid, quote_number text, status text, project_name text,
  estimator_initials text, total_cents bigint, deleted_at timestamptz,
  customer_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  RETURN QUERY
  SELECT
    q.quote_id, q.quote_number::text, q.status::text, q.project_name::text,
    q.estimator_initials::text, q.total_cents, q.deleted_at, c.company_name::text
  FROM app_data.quote q
  LEFT JOIN app_data.customers c ON c.customer_id = q.customer_id
  WHERE q.tenant_id = v_tenant_id AND q.deleted_at IS NOT NULL
  ORDER BY q.deleted_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_trashed_quotes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_list_trashed_quotes() TO authenticated;
