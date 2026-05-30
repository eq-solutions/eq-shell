-- 0027_drop_intake_vestiges.sql
-- Remove the vestigial intake objects + the exec_sql backdoor from every tenant.
--
-- WHY these are vestigial (verified live 2026-05-30):
--   * Intake COMMIT runs through netlify/functions/intake-commit.ts → the per-app
--     8-arg eq_intake_commit_batch_<module> fns, which were verified to reference
--     NONE of the objects dropped here. The browser uses that orchestrator, not a
--     direct RPC — so the generic dispatcher + its 4/5/6-arg overloads have no caller.
--   * Intake LIFECYCLE (create/finish/rollback/audit) runs on the CONTROL plane
--     (jvkn): AdminAuditPage calls eq_intake_event_rows (jvkn-only) on the same
--     client as eq_intake_rollback, proving those run on jvkn. Tenant copies are dead.
--   * eq_get_intake_health reads a non-existent app_data.intake_events (cannot run).
--     eq_exec_sql/_eq_exec_sql are the legacy migration-runner backdoor; applies now
--     go through the Supabase Management API.
--
-- KEEPS the live 8-arg per-app commit fns + _eq_intake_apply_metadata (canonical).
-- Idempotent: DROP IF EXISTS + per-fn exception handling, so it (a) no-ops on tenants
-- that lack these (e.g. EQ keeps only the 8-arg fns) and (b) SKIPS any fn still wired
-- as a trigger (eq_intake_template_track_* on shell_control.eq_intake_events — that
-- whole subsystem is retired in a separate, reviewed step) rather than aborting.

BEGIN;

DO $$
DECLARE r record; v_skipped text := '';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE
      -- generic dispatcher: every overload
      ( n.nspname='public' AND p.proname = 'eq_intake_commit_batch' )
      -- per-app: only the superseded 6-arg overload (the live 8-arg has p_source_sig)
      OR ( n.nspname='public'
           AND p.proname IN ('eq_intake_commit_batch_cards','eq_intake_commit_batch_core',
                             'eq_intake_commit_batch_field','eq_intake_commit_batch_quotes',
                             'eq_intake_commit_batch_service')
           AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_source_sig%' )
      -- helpers / lifecycle / template / list vestiges
      OR ( n.nspname='public' AND p.proname IN (
             '_eq_exec_sql','_eq_intake_check_tenant_match','_eq_intake_load_event_meta',
             '_eq_intake_record_committed','_eq_intake_unwind_cards','_eq_intake_unwind_core',
             '_eq_intake_unwind_field','_eq_intake_unwind_quotes','_eq_intake_unwind_service',
             'eq_create_intake_event','eq_finish_intake_event','eq_get_intake_event_status',
             'eq_mark_intake_rolled_back','eq_intake_rollback','eq_intake_find_template_by_signature',
             'eq_intake_template_track_outcome','eq_intake_template_track_use','eq_list_module_entities') )
      -- exec_sql backdoor + dead health fn
      OR ( n.nspname='app_data' AND p.proname IN ('eq_exec_sql','eq_get_intake_health') )
  LOOP
    BEGIN
      EXECUTE 'DROP FUNCTION ' || r.sig || ';';
    EXCEPTION WHEN dependent_objects_still_exist THEN
      v_skipped := v_skipped || r.sig || '; ';
    END;
  END LOOP;
  IF v_skipped <> '' THEN
    RAISE NOTICE '0027: skipped (still has dependents, retire separately): %', v_skipped;
  END IF;
END $$;

COMMIT;
