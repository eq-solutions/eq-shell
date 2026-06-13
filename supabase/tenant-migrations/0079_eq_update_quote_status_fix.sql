-- Migration: 0079_eq_update_quote_status_fix
-- Target:    Per-tenant data plane
-- Purpose:   CRITICAL correctness fix — eq_update_quote_status has never run.
--
--   The function inserts into app_data.quote_status_history (..., note, ...),
--   but that table's column is `reason`, not `note`:
--       ERROR 42703: column "note" of relation "quote_status_history" does not exist
--   So every native quote status transition failed. (Caught by Sprint-1 live
--   verification — pairs with the create-path bug fixed in 0078.)
--
--   Fix: insert p_note into the existing `reason` column. The job_notes audit
--   insert was already correct and is preserved unchanged.
--
-- Idempotent (CREATE OR REPLACE; signature unchanged from 0073 v3).

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
  v_tenant_id  uuid;
  v_old_status text;
  v_note_body  text;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT status INTO v_old_status
  FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;

  UPDATE app_data.quote
  SET
    status           = p_new_status,
    updated_at       = now(),
    sent_at          = CASE
                         WHEN p_new_status = 'submitted' AND sent_at IS NULL
                         THEN now() ELSE sent_at
                       END,
    sent_by_initials = CASE
                         WHEN p_new_status = 'submitted' AND sent_by_initials IS NULL
                         THEN p_initials ELSE sent_by_initials
                       END,
    loss_reason      = CASE
                         WHEN p_new_status = 'lost'
                         THEN COALESCE(p_note, loss_reason) ELSE loss_reason
                       END
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;

  -- Structured status history (column is `reason`, not `note`)
  INSERT INTO app_data.quote_status_history
    (tenant_id, quote_id, from_status, to_status, changed_by_initials, reason, changed_at)
  VALUES
    (v_tenant_id, p_quote_id, v_old_status, p_new_status, p_initials, p_note, now());

  -- Human-readable audit note shown in the detail panel timeline
  v_note_body := v_old_status || ' → ' || p_new_status
    || CASE WHEN p_note IS NOT NULL AND p_note <> '' THEN ': ' || p_note ELSE '' END;

  INSERT INTO app_data.job_notes
    (tenant_id, quote_id, body, note_type, created_by_initials)
  VALUES
    (v_tenant_id, p_quote_id, v_note_body, 'status-change', p_initials);
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) TO authenticated;
