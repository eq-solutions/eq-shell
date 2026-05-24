-- Migration: 0009_intake_quotes_rpc
-- Target:    Per-tenant data plane
-- Purpose:   Quotes intake commit RPC. Third module of the staged
--            intake-writer migration (Phase 2.B.6 in ARCHITECTURE-V2.md,
--            after 0005 cards + 0008 service).
--
--            Covers 7 tables. Two PK shapes:
--              parent:  quote (PK quote_id, no parent FK)
--              children of quote (CASCADE):
--                quote_line_item        (PK line_item_id,    FK quote_id)
--                quote_status_history   (PK history_id,      FK quote_id)
--                quote_attachment       (PK attachment_id,   FK quote_id)
--                quote_email_outbox     (PK outbox_id,       FK quote_id)
--              lookup tables (no FK back to quote):
--                scope_template         (PK template_id)
--                rate_library           (PK rate_id)
--
--            Caller is responsible for FK-safe call ordering — typically
--            commit quote first, then its children — same as the shared
--            eq_intake_commit_batch did. The RPC doesn't try to reorder
--            within a single batch; one call = one table.
--
--            Reuses public._eq_intake_apply_metadata from 0005.

CREATE OR REPLACE FUNCTION public.eq_intake_commit_batch_quotes(
  p_intake_id        uuid,
  p_tenant_id        uuid,
  p_table            text,
  p_rows             jsonb,
  p_source_sig       text,
  p_schema_version   text,
  p_import_mode      text DEFAULT 'append',
  p_confirm_replace  boolean DEFAULT false
)
RETURNS TABLE(committed_count integer, committed_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $function$
DECLARE
  v_count int := 0;
  v_ids   uuid[] := ARRAY[]::uuid[];
  v_row   jsonb;
  v_id    uuid;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id is required'; END IF;
  IF p_intake_id IS NULL THEN RAISE EXCEPTION 'p_intake_id is required'; END IF;
  IF p_table NOT IN ('quote','quote_line_item','quote_status_history','quote_attachment','quote_email_outbox','scope_template','rate_library') THEN
    RAISE EXCEPTION 'table % not quotes-domain', p_table;
  END IF;
  IF p_import_mode NOT IN ('append', 'upsert', 'replace') THEN
    RAISE EXCEPTION 'invalid import_mode: % (expected append | upsert | replace)', p_import_mode;
  END IF;

  IF p_import_mode = 'replace' THEN
    IF NOT p_confirm_replace THEN
      RAISE EXCEPTION 'replace requires p_confirm_replace=true';
    END IF;
    EXECUTE format('DELETE FROM app_data.%I WHERE tenant_id = $1 AND imported_from = $2', p_table)
      USING p_tenant_id, p_source_sig;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_row := _eq_intake_apply_metadata(v_row, p_tenant_id, p_intake_id, p_source_sig, p_schema_version);

    -- Per-table dispatch. INSERT INTO ... SELECT * FROM jsonb_populate_record
    -- handles the column projection automatically. Upsert SET lists exclude
    -- the PK, tenant_id (can't legitimately change), and created_*/updated_*
    -- (DB triggers/defaults manage those — matching the cards/service style).
    IF p_table = 'quote' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.quote
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote, v_row)
          ON CONFLICT (quote_id) DO UPDATE SET
            customer_id        = EXCLUDED.customer_id,
            contact_id         = EXCLUDED.contact_id,
            site_id            = EXCLUDED.site_id,
            quote_number       = EXCLUDED.quote_number,
            external_id        = EXCLUDED.external_id,
            project_name       = EXCLUDED.project_name,
            attn_name          = EXCLUDED.attn_name,
            attn_first_name    = EXCLUDED.attn_first_name,
            attn_phone         = EXCLUDED.attn_phone,
            address            = EXCLUDED.address,
            scope_of_works     = EXCLUDED.scope_of_works,
            estimator_name     = EXCLUDED.estimator_name,
            estimator_initials = EXCLUDED.estimator_initials,
            status             = EXCLUDED.status,
            subtotal_cents     = EXCLUDED.subtotal_cents,
            gst_cents          = EXCLUDED.gst_cents,
            total_cents        = EXCLUDED.total_cents,
            margin_pct         = EXCLUDED.margin_pct,
            sent_at            = EXCLUDED.sent_at,
            sent_by_initials   = EXCLUDED.sent_by_initials,
            notes              = EXCLUDED.notes,
            imported_at        = EXCLUDED.imported_at,
            imported_from      = EXCLUDED.imported_from,
            intake_id          = EXCLUDED.intake_id,
            schema_version     = EXCLUDED.schema_version
          RETURNING quote_id INTO v_id;
      ELSE
        INSERT INTO app_data.quote
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote, v_row)
          RETURNING quote_id INTO v_id;
      END IF;

    ELSIF p_table = 'quote_line_item' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.quote_line_item
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_line_item, v_row)
          ON CONFLICT (line_item_id) DO UPDATE SET
            quote_id              = EXCLUDED.quote_id,
            line_number           = EXCLUDED.line_number,
            description           = EXCLUDED.description,
            quantity_thousandths  = EXCLUDED.quantity_thousandths,
            unit                  = EXCLUDED.unit,
            unit_rate_cents       = EXCLUDED.unit_rate_cents,
            line_total_cents      = EXCLUDED.line_total_cents,
            category              = EXCLUDED.category,
            notes                 = EXCLUDED.notes,
            imported_at           = EXCLUDED.imported_at,
            imported_from         = EXCLUDED.imported_from,
            intake_id             = EXCLUDED.intake_id,
            schema_version        = EXCLUDED.schema_version
          RETURNING line_item_id INTO v_id;
      ELSE
        INSERT INTO app_data.quote_line_item
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_line_item, v_row)
          RETURNING line_item_id INTO v_id;
      END IF;

    ELSIF p_table = 'quote_status_history' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.quote_status_history
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_status_history, v_row)
          ON CONFLICT (history_id) DO UPDATE SET
            quote_id             = EXCLUDED.quote_id,
            from_status          = EXCLUDED.from_status,
            to_status            = EXCLUDED.to_status,
            changed_by_initials  = EXCLUDED.changed_by_initials,
            changed_by_user_id   = EXCLUDED.changed_by_user_id,
            reason               = EXCLUDED.reason,
            changed_at           = EXCLUDED.changed_at,
            imported_at          = EXCLUDED.imported_at,
            imported_from        = EXCLUDED.imported_from,
            intake_id            = EXCLUDED.intake_id,
            schema_version       = EXCLUDED.schema_version
          RETURNING history_id INTO v_id;
      ELSE
        INSERT INTO app_data.quote_status_history
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_status_history, v_row)
          RETURNING history_id INTO v_id;
      END IF;

    ELSIF p_table = 'quote_attachment' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.quote_attachment
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_attachment, v_row)
          ON CONFLICT (attachment_id) DO UPDATE SET
            quote_id                = EXCLUDED.quote_id,
            file_name               = EXCLUDED.file_name,
            file_size_bytes         = EXCLUDED.file_size_bytes,
            mime_type               = EXCLUDED.mime_type,
            storage_path            = EXCLUDED.storage_path,
            sha256                  = EXCLUDED.sha256,
            doc_type                = EXCLUDED.doc_type,
            quote_snapshot          = EXCLUDED.quote_snapshot,
            generated_by_initials   = EXCLUDED.generated_by_initials,
            generated_at            = EXCLUDED.generated_at,
            uploaded_at             = EXCLUDED.uploaded_at,
            imported_at             = EXCLUDED.imported_at,
            imported_from           = EXCLUDED.imported_from,
            intake_id               = EXCLUDED.intake_id,
            schema_version          = EXCLUDED.schema_version
          RETURNING attachment_id INTO v_id;
      ELSE
        INSERT INTO app_data.quote_attachment
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_attachment, v_row)
          RETURNING attachment_id INTO v_id;
      END IF;

    ELSIF p_table = 'quote_email_outbox' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.quote_email_outbox
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_email_outbox, v_row)
          ON CONFLICT (outbox_id) DO UPDATE SET
            quote_id        = EXCLUDED.quote_id,
            to_email        = EXCLUDED.to_email,
            to_name         = EXCLUDED.to_name,
            cc_emails       = EXCLUDED.cc_emails,
            bcc_emails      = EXCLUDED.bcc_emails,
            subject         = EXCLUDED.subject,
            body_html       = EXCLUDED.body_html,
            body_text       = EXCLUDED.body_text,
            attachment_ids  = EXCLUDED.attachment_ids,
            status          = EXCLUDED.status,
            queued_at       = EXCLUDED.queued_at,
            sent_at         = EXCLUDED.sent_at,
            failed_at       = EXCLUDED.failed_at,
            error_message   = EXCLUDED.error_message,
            attempt_count   = EXCLUDED.attempt_count,
            imported_at     = EXCLUDED.imported_at,
            imported_from   = EXCLUDED.imported_from,
            intake_id       = EXCLUDED.intake_id,
            schema_version  = EXCLUDED.schema_version
          RETURNING outbox_id INTO v_id;
      ELSE
        INSERT INTO app_data.quote_email_outbox
          SELECT * FROM jsonb_populate_record(NULL::app_data.quote_email_outbox, v_row)
          RETURNING outbox_id INTO v_id;
      END IF;

    ELSIF p_table = 'scope_template' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.scope_template
          SELECT * FROM jsonb_populate_record(NULL::app_data.scope_template, v_row)
          ON CONFLICT (template_id) DO UPDATE SET
            name            = EXCLUDED.name,
            category        = EXCLUDED.category,
            body            = EXCLUDED.body,
            sort_order      = EXCLUDED.sort_order,
            active          = EXCLUDED.active,
            imported_at     = EXCLUDED.imported_at,
            imported_from   = EXCLUDED.imported_from,
            intake_id       = EXCLUDED.intake_id,
            schema_version  = EXCLUDED.schema_version
          RETURNING template_id INTO v_id;
      ELSE
        INSERT INTO app_data.scope_template
          SELECT * FROM jsonb_populate_record(NULL::app_data.scope_template, v_row)
          RETURNING template_id INTO v_id;
      END IF;

    ELSIF p_table = 'rate_library' THEN
      IF p_import_mode = 'upsert' THEN
        INSERT INTO app_data.rate_library
          SELECT * FROM jsonb_populate_record(NULL::app_data.rate_library, v_row)
          ON CONFLICT (rate_id) DO UPDATE SET
            code             = EXCLUDED.code,
            description      = EXCLUDED.description,
            category         = EXCLUDED.category,
            unit             = EXCLUDED.unit,
            unit_cost_cents  = EXCLUDED.unit_cost_cents,
            unit_sell_cents  = EXCLUDED.unit_sell_cents,
            margin_pct       = EXCLUDED.margin_pct,
            active           = EXCLUDED.active,
            imported_at      = EXCLUDED.imported_at,
            imported_from    = EXCLUDED.imported_from,
            intake_id        = EXCLUDED.intake_id,
            schema_version   = EXCLUDED.schema_version
          RETURNING rate_id INTO v_id;
      ELSE
        INSERT INTO app_data.rate_library
          SELECT * FROM jsonb_populate_record(NULL::app_data.rate_library, v_row)
          RETURNING rate_id INTO v_id;
      END IF;
    END IF;

    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      v_ids   := array_append(v_ids, v_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_count, v_ids;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_intake_commit_batch_quotes(uuid, uuid, text, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_intake_commit_batch_quotes(uuid, uuid, text, jsonb, text, text, text, boolean) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0009_intake_quotes_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
