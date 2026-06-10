-- ============================================================
-- Migration 0096: Pre-visit tech brief — Phase 0 data layer.
--
-- Two changes, both idempotent:
--
--   1. Add `scheduled_start_at timestamptz NULL` to
--      public.maintenance_checks. The existing `due_date` is the
--      compliance deadline, not the on-site visit time. Phase 1 will
--      surface an inline editor for this on /maintenance/[id] and use
--      it in the ICS attachment of the pre-visit brief email.
--      Nullable — most existing checks (and many future ad-hoc ones)
--      won't have a scheduled visit window set.
--
--   2. Backfill `assigned_to = created_by` on scheduled checks where
--      `assigned_to IS NULL AND created_by IS NOT NULL`. Closes the
--      Phase-0 enforcement loop: from this migration onward,
--      transitions to `status='scheduled'` require `assigned_to` to
--      be non-null (enforced in app/(app)/maintenance/actions.ts).
--      Existing scheduled rows that pre-date that rule get
--      `created_by` as a sensible default so the new check on the
--      update path doesn't lock those rows out of further edits.
--      Rows with `created_by IS NULL` (legacy import/system-generated
--      checks) are left untouched — they'll need explicit assignment
--      via the /admin or the UI when next opened.
--
-- Idempotency:
--   - ADD COLUMN uses IF NOT EXISTS — re-running is a no-op.
--   - Backfill UPDATE filters on `assigned_to IS NULL` — once a row
--     has been backfilled (or set by the app), it's skipped on
--     subsequent runs.
--   - The audit_logs marker row uses a guarded INSERT keyed on a
--     fixed summary string so re-running doesn't pile up duplicate
--     marker rows.
--
-- Rollback strategy:
--   To revert this migration's backfill (column drop is its own
--   destructive operation — separate decision):
--
--   -- 1. Find rows touched by this backfill via the audit marker
--   --    written below (summary = 'phase_0_backfill_assigned_to').
--   --    The marker row's metadata.row_ids contains the uuid list.
--   SELECT metadata
--     FROM public.audit_logs
--    WHERE entity_type = 'maintenance_check'
--      AND action = 'backfill'
--      AND summary = 'phase_0_backfill_assigned_to'
--    ORDER BY created_at DESC LIMIT 1;
--
--   -- 2. Reset those rows back to NULL.
--   UPDATE public.maintenance_checks
--      SET assigned_to = NULL
--    WHERE id = ANY ( ARRAY(<the uuid list from above>)::uuid[] );
--
--   The `scheduled_start_at` column is purely additive and nullable,
--   so reverting it is a single ALTER TABLE … DROP COLUMN — but only
--   after Phase 1 features that read from it have been rolled back.
-- ============================================================

-- ── 1. New column ─────────────────────────────────────────────────

ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS scheduled_start_at timestamptz NULL;

COMMENT ON COLUMN public.maintenance_checks.scheduled_start_at IS
  'Optional on-site visit start time. Distinct from `due_date` (compliance deadline) — this is when the tech is expected to arrive. Used by the pre-visit brief email + ICS attachment (Phase 1). Nullable: many checks never get a hard scheduled window.';

-- ── 2. Backfill assigned_to = created_by on scheduled checks ──────

DO $$
DECLARE
  v_row_ids uuid[];
  v_tenant_count int;
BEGIN
  -- Capture the ids we're about to touch so we can write them to the
  -- audit marker for rollback. Run inside a single statement so the
  -- SELECT and UPDATE see the same snapshot.
  WITH targets AS (
    SELECT id
      FROM public.maintenance_checks
     WHERE status = 'scheduled'
       AND assigned_to IS NULL
       AND created_by IS NOT NULL
       AND is_active = true
  ), updated AS (
    UPDATE public.maintenance_checks mc
       SET assigned_to = mc.created_by,
           updated_at  = now()
      FROM targets
     WHERE mc.id = targets.id
    RETURNING mc.id
  )
  SELECT array_agg(id) INTO v_row_ids FROM updated;

  IF v_row_ids IS NULL THEN
    v_row_ids := ARRAY[]::uuid[];
  END IF;

  -- Write one audit marker per affected tenant so the rollback query
  -- in the header comment can find the row ids. Keyed on
  -- (tenant_id, summary='phase_0_backfill_assigned_to') so re-running
  -- the migration doesn't double-insert when the backfill itself is a
  -- no-op (in which case v_row_ids is empty and we skip).
  IF array_length(v_row_ids, 1) > 0 THEN
    INSERT INTO public.audit_logs (
      tenant_id, user_id, action, entity_type, entity_id, summary, metadata
    )
    SELECT
      grp.tenant_id,
      NULL,
      'backfill',
      'maintenance_check',
      NULL,
      'phase_0_backfill_assigned_to',
      jsonb_build_object(
        'migration', '0096_pre_visit_phase_0_schema',
        'row_ids', to_jsonb(grp.row_ids)
      )
      FROM (
        SELECT mc.tenant_id, array_agg(mc.id) AS row_ids
          FROM public.maintenance_checks mc
         WHERE mc.id = ANY (v_row_ids)
         GROUP BY mc.tenant_id
      ) grp
     WHERE NOT EXISTS (
       SELECT 1 FROM public.audit_logs al
        WHERE al.tenant_id   = grp.tenant_id
          AND al.entity_type = 'maintenance_check'
          AND al.action      = 'backfill'
          AND al.summary     = 'phase_0_backfill_assigned_to'
     );

    GET DIAGNOSTICS v_tenant_count = ROW_COUNT;
    RAISE NOTICE 'Phase 0 backfill: touched % rows; wrote % audit marker(s)',
      array_length(v_row_ids, 1), v_tenant_count;
  ELSE
    RAISE NOTICE 'Phase 0 backfill: no rows matched (assigned_to already set or created_by NULL)';
  END IF;
END$$;
