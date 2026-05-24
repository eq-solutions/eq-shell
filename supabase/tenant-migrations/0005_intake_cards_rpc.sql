-- Migration: 0005_intake_cards_rpc
-- Target:    Per-tenant data plane
-- Purpose:   Cards intake commit RPC (licences). First module of the
--            staged intake-writer migration (Phase 2.B.6 in
--            ARCHITECTURE-V2.md). Body mirrors the shared
--            eq_intake_commit_batch_cards, except:
--              - Takes p_tenant_id explicitly (service-role has no JWT)
--              - Takes p_source_sig + p_schema_version + p_import_mode
--                explicitly (no shell_control.eq_intake_events table here
--                to look them up from)
--              - Drops audit writes — the orchestrator function does them
--                back on the control plane after this RPC returns.
--              - Drops _eq_intake_check_tenant_match — the tenant DB is
--                single-tenant by construction.
--
--            Helper _eq_intake_apply_metadata stays inlined here so we
--            don't need a separate helper migration just for one column-
--            stamping pure function.

-- ──────────────────────────────────────────────────────────────────────
-- Metadata helper. Pure function — stamps tenant_id / intake_id /
-- imported_at / imported_from / schema_version onto a row jsonb.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._eq_intake_apply_metadata(
  p_row jsonb,
  p_tenant_id uuid,
  p_intake_id uuid,
  p_source_sig text,
  p_schema_version text
)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT p_row
    || jsonb_build_object('tenant_id', p_tenant_id)
    || jsonb_build_object('intake_id', p_intake_id)
    || jsonb_build_object('imported_at', to_jsonb(now()))
    || jsonb_build_object('imported_from', to_jsonb(p_source_sig))
    || jsonb_build_object('schema_version', to_jsonb(p_schema_version));
$$;

REVOKE ALL ON FUNCTION public._eq_intake_apply_metadata(jsonb, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._eq_intake_apply_metadata(jsonb, uuid, uuid, text, text) TO service_role;

-- ──────────────────────────────────────────────────────────────────────
-- Cards commit batch. Writes to app_data.licences. Supports append,
-- upsert, and replace modes (same semantics as the shared version).
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.eq_intake_commit_batch_cards(
  p_intake_id        uuid,
  p_tenant_id        uuid,
  p_table            text,
  p_rows             jsonb,
  p_source_sig       text,
  p_schema_version   text,
  p_import_mode      text DEFAULT 'append',     -- 'append' | 'upsert' | 'replace'
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
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;
  IF p_intake_id IS NULL THEN
    RAISE EXCEPTION 'p_intake_id is required';
  END IF;
  IF p_table NOT IN ('licences') THEN
    RAISE EXCEPTION 'table % not cards-domain (only licences supported)', p_table;
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

    IF p_import_mode = 'upsert' THEN
      INSERT INTO app_data.licences
        SELECT * FROM jsonb_populate_record(NULL::app_data.licences, v_row)
        ON CONFLICT (licence_id) DO UPDATE SET
          staff_id          = EXCLUDED.staff_id,
          external_id       = EXCLUDED.external_id,
          licence_type      = EXCLUDED.licence_type,
          licence_number    = EXCLUDED.licence_number,
          issuing_authority = EXCLUDED.issuing_authority,
          state             = EXCLUDED.state,
          issue_date        = EXCLUDED.issue_date,
          expiry_date       = EXCLUDED.expiry_date,
          photo_front_path  = EXCLUDED.photo_front_path,
          photo_back_path   = EXCLUDED.photo_back_path,
          notes             = EXCLUDED.notes,
          metadata          = EXCLUDED.metadata,
          active            = EXCLUDED.active,
          imported_at       = EXCLUDED.imported_at,
          imported_from     = EXCLUDED.imported_from,
          intake_id         = EXCLUDED.intake_id,
          schema_version    = EXCLUDED.schema_version
        RETURNING licence_id INTO v_id;
    ELSE
      INSERT INTO app_data.licences
        SELECT * FROM jsonb_populate_record(NULL::app_data.licences, v_row)
        RETURNING licence_id INTO v_id;
    END IF;

    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      v_ids   := array_append(v_ids, v_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_count, v_ids;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_intake_commit_batch_cards(uuid, uuid, text, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_intake_commit_batch_cards(uuid, uuid, text, jsonb, text, text, text, boolean) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0005_intake_cards_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
