-- Migration: 0008_intake_service_rpc
-- Target:    Per-tenant data plane
-- Purpose:   Service intake commit RPC (assets). Second module of the
--            staged intake-writer migration (Phase 2.B.6 in
--            ARCHITECTURE-V2.md, after 0005_intake_cards_rpc).
--
--            Mirrors 0005 verbatim except:
--              - Validates p_table = 'assets' (single table in this module)
--              - Upsert ON CONFLICT key = asset_id
--              - Upsert SET list covers every non-PK column on app_data.assets
--
--            Reuses public._eq_intake_apply_metadata from 0005 — that
--            helper is module-agnostic and was deliberately not namespaced
--            so each subsequent module RPC can reach for it.

CREATE OR REPLACE FUNCTION public.eq_intake_commit_batch_service(
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
  IF p_table NOT IN ('assets') THEN
    RAISE EXCEPTION 'table % not service-domain (only assets supported)', p_table;
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
      INSERT INTO app_data.assets
        SELECT * FROM jsonb_populate_record(NULL::app_data.assets, v_row)
        ON CONFLICT (asset_id) DO UPDATE SET
          external_id            = EXCLUDED.external_id,
          site_id                = EXCLUDED.site_id,
          parent_asset_id        = EXCLUDED.parent_asset_id,
          asset_type             = EXCLUDED.asset_type,
          name                   = EXCLUDED.name,
          make                   = EXCLUDED.make,
          model                  = EXCLUDED.model,
          serial_number          = EXCLUDED.serial_number,
          rating                 = EXCLUDED.rating,
          install_date           = EXCLUDED.install_date,
          warranty_expires       = EXCLUDED.warranty_expires,
          criticality            = EXCLUDED.criticality,
          condition              = EXCLUDED.condition,
          service_schedule_id    = EXCLUDED.service_schedule_id,
          ppm_frequency          = EXCLUDED.ppm_frequency,
          last_service_date      = EXCLUDED.last_service_date,
          next_service_due       = EXCLUDED.next_service_due,
          location_in_site       = EXCLUDED.location_in_site,
          barcode                = EXCLUDED.barcode,
          active                 = EXCLUDED.active,
          defects_summary        = EXCLUDED.defects_summary,
          client_classification  = EXCLUDED.client_classification,
          notes                  = EXCLUDED.notes,
          imported_at            = EXCLUDED.imported_at,
          imported_from          = EXCLUDED.imported_from,
          intake_id              = EXCLUDED.intake_id,
          schema_version         = EXCLUDED.schema_version
        RETURNING asset_id INTO v_id;
    ELSE
      INSERT INTO app_data.assets
        SELECT * FROM jsonb_populate_record(NULL::app_data.assets, v_row)
        RETURNING asset_id INTO v_id;
    END IF;

    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      v_ids   := array_append(v_ids, v_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_count, v_ids;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_intake_commit_batch_service(uuid, uuid, text, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_intake_commit_batch_service(uuid, uuid, text, jsonb, text, text, text, boolean) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0008_intake_service_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
