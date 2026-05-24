-- Migration: 0011_intake_field_rpc
-- Target:    Per-tenant data plane
-- Purpose:   Field intake commit RPC. Final module of the staged
--            intake-writer migration (Phase 2.B.6 in ARCHITECTURE-V2.md,
--            after 0005 cards + 0008 service + 0009 quotes + 0010 core).
--
--            Covers ~30 field-domain tables — staff, schedule, timesheets,
--            leave, prestart, toolbox, swms, jsa, itp, incidents, tenders
--            and their child + log tables.
--
--            Unlike the per-module RPCs above, this one uses runtime
--            introspection (pg_catalog + information_schema) inside a single
--            EXECUTE format() to build the INSERT and ON CONFLICT clause.
--            Reason: 30 tables × bespoke SET lists = ~3,000 lines of
--            mechanical SQL that drifts every time someone adds a column.
--            Dynamic dispatch keeps the file ~120 lines and stays correct
--            automatically as the schema evolves. Cost: per-call plan
--            preparation (no cached plan). Field intake is bulk CSV upload
--            — not hot path — so the overhead is negligible.
--
--            The allow-list constant (v_allowed) is the source of truth
--            for which tables this module accepts. Adding a table is a
--            one-line change here + the TABLE_MODULE map in intake-commit.ts.
--
--            Reuses public._eq_intake_apply_metadata from 0005.

CREATE OR REPLACE FUNCTION public.eq_intake_commit_batch_field(
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
  -- Allow-list of field-domain tables. Order matches the
  -- TABLE_MODULE map in netlify/functions/intake-commit.ts.
  v_allowed text[] := ARRAY[
    'staff',
    'apprentice_profiles', 'buddy_checkins', 'checkins',
    'engagement_logs', 'feedback_entries',
    'incidents',
    'itp_records', 'jsa_records', 'swms', 'prestart_checks', 'toolbox_talks',
    'jobs',
    'leave_approval_logs', 'leave_balances', 'leave_requests',
    'quarterly_reviews', 'rotations',
    'schedule_change_logs', 'schedule_entries',
    'site_diaries', 'skills_ratings',
    'tafe_calendars',
    'tender_enrichments', 'tender_import_runs', 'tender_nominations',
    'tender_review_decisions', 'tenders',
    'timesheets', 'weekly_reports'
  ];

  -- Columns the metadata helper stamps onto every row and that we never
  -- want to drive from import payload (they're either system-managed or
  -- stamped by the helper itself).
  v_skip_cols text[] := ARRAY['tenant_id','created_at','created_by','updated_at','updated_by'];

  v_count int := 0;
  v_ids   uuid[] := ARRAY[]::uuid[];
  v_row   jsonb;
  v_id    uuid;
  v_pk    text;
  v_set   text;
  v_sql   text;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id is required'; END IF;
  IF p_intake_id IS NULL THEN RAISE EXCEPTION 'p_intake_id is required'; END IF;
  IF NOT (p_table = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'table % not field-domain', p_table;
  END IF;
  IF p_import_mode NOT IN ('append', 'upsert', 'replace') THEN
    RAISE EXCEPTION 'invalid import_mode: %', p_import_mode;
  END IF;

  -- Resolve PK column for this table from pg_catalog.
  SELECT a.attname INTO v_pk
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_namespace n  ON n.oid = t.relnamespace
  JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'app_data' AND c.contype = 'p' AND t.relname = p_table
  LIMIT 1;
  IF v_pk IS NULL THEN
    RAISE EXCEPTION 'no primary key found for app_data.%', p_table;
  END IF;

  -- Build the ON CONFLICT SET list dynamically — every writable column
  -- except the PK + the skip list. format(%I) handles identifier quoting.
  SELECT string_agg(format('%I = EXCLUDED.%I', column_name, column_name), ', ')
    INTO v_set
  FROM information_schema.columns
  WHERE table_schema = 'app_data'
    AND table_name   = p_table
    AND column_name  <> v_pk
    AND NOT (column_name = ANY(v_skip_cols));

  IF p_import_mode = 'replace' THEN
    IF NOT p_confirm_replace THEN RAISE EXCEPTION 'replace requires p_confirm_replace=true'; END IF;
    EXECUTE format('DELETE FROM app_data.%I WHERE tenant_id = $1 AND imported_from = $2', p_table)
      USING p_tenant_id, p_source_sig;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_row := _eq_intake_apply_metadata(v_row, p_tenant_id, p_intake_id, p_source_sig, p_schema_version);

    IF p_import_mode = 'upsert' THEN
      v_sql := format(
        'INSERT INTO app_data.%I SELECT * FROM jsonb_populate_record(NULL::app_data.%I, $1) ON CONFLICT (%I) DO UPDATE SET %s RETURNING %I',
        p_table, p_table, v_pk, v_set, v_pk
      );
    ELSE
      v_sql := format(
        'INSERT INTO app_data.%I SELECT * FROM jsonb_populate_record(NULL::app_data.%I, $1) RETURNING %I',
        p_table, p_table, v_pk
      );
    END IF;

    EXECUTE v_sql INTO v_id USING v_row;

    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      v_ids   := array_append(v_ids, v_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_count, v_ids;
END
$function$;

REVOKE ALL ON FUNCTION public.eq_intake_commit_batch_field(uuid, uuid, text, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_intake_commit_batch_field(uuid, uuid, text, jsonb, text, text, text, boolean) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0011_intake_field_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
