-- Migration: 0082_quote_accepted_event
-- Target:    Per-tenant data plane
-- Purpose:   Wire the native "Won" action into the existing quote -> job pipeline.
--
--   The operational spine already exists: quote-job-consumer (scheduled Netlify fn)
--   reads app_data.canonical_events WHERE event='quote.accepted' and upserts a
--   canonical app_data.jobs row via canonical-api (idempotent on
--   external_id='eq-quotes:job:<quote_id>'). But nothing EMITTED that event for
--   native quotes — eq_update_quote_status only wrote status_history + a note — so
--   the consumer never fired for an EQ Ops quote.
--
--   Fix: when a quote first transitions to 'verbal-win' (the deal-won signal in the
--   EQ Ops lifecycle: draft -> submitted -> verbal-win -> won-* ...), emit a
--   'quote.accepted' canonical event carrying quote_id + reference + customer/site
--   so the consumer can create a fully-linked job. Emitting once on entry to
--   verbal-win; the consumer is idempotent on external_id, so a stray re-emit is a
--   no-op. idempotency_key left NULL (NULLs don't collide in the unique index).
--
-- Idempotent (CREATE OR REPLACE; signature unchanged from 0079).

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

  -- Deal won → emit the canonical event the quote->job consumer listens for.
  IF p_new_status = 'verbal-win' AND v_old_status IS DISTINCT FROM 'verbal-win' THEN
    SELECT c.company_name INTO v_customer_name
    FROM app_data.customers c
    WHERE c.customer_id = v_customer_id AND c.tenant_id = v_tenant_id;

    INSERT INTO app_data.canonical_events
      (tenant_id, app_source, event, payload, occurred_at)
    VALUES
      (v_tenant_id, 'quotes', 'quote.accepted',
       jsonb_build_object(
         'quote_id',      p_quote_id,
         'reference',     v_quote_number,
         'customer_name', v_customer_name,
         'customer_id',   v_customer_id,
         'site_id',       v_site_id
       ),
       now());
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.eq_update_quote_status(uuid, text, text, text) TO authenticated;
