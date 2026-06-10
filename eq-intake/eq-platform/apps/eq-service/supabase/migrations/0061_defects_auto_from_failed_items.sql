-- ============================================================
-- Migration 0061: Defects auto-population from failed test items
--
-- Context: Royce's review (26 Apr 2026) — defects today are manual-only.
-- Promote any maintenance_check_item that lands on result='fail' into the
-- defects register automatically, so site teams don't have to double-key
-- problems they've already noted on the check.
--
-- Decisions:
--   - Trigger fires on INSERT or UPDATE of result column.
--   - On flip TO 'fail': create a 'defects' row.
--   - On flip FROM 'fail' (e.g. amended after re-inspection): mark the
--     auto-created defect as 'resolved' instead of deleting — preserves
--     the audit trail of what was originally flagged.
--   - Severity rule (per Royce 26 Apr): test category drives it.
--       Visual    → low
--       Functional→ medium
--       Electrical→ high
--     maintenance_check_items don't currently carry a category, so this
--     trigger defaults to 'medium' for all of them. The ACB / NSX paths
--     can override severity when those triggers are wired in a follow-up.
--   - Source tracking: a 'source' column on defects distinguishes auto vs
--     manual entries. Auto entries also carry a back-pointer to the
--     originating check_item id so the reverse-on-un-fail flow works.
--
-- Idempotent: trigger uses CREATE OR REPLACE so it can be re-applied.
-- Defect row uses ON CONFLICT to avoid duplicates if the trigger runs
-- twice for the same item (e.g. a user edits the description after a fail).
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Add source + source-id columns to defects
-- ---------------------------------------------------------------------------
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_check_item_id uuid REFERENCES public.maintenance_check_items(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'defects_source_check'
  ) THEN
    ALTER TABLE public.defects
      ADD CONSTRAINT defects_source_check
      CHECK (source IN ('manual', 'auto_check_item', 'auto_acb_test', 'auto_nsx_test', 'auto_general_test', 'import'));
  END IF;
END$$;

COMMENT ON COLUMN public.defects.source IS
  'How this defect was created. ''manual'' = user-entered; ''auto_*'' = trigger-created from a failed test item or reading.';
COMMENT ON COLUMN public.defects.source_check_item_id IS
  'Back-pointer to the originating maintenance_check_items row when source=''auto_check_item''. Used by the reverse-on-un-fail trigger to mark resolved.';

-- Unique-by-source so the trigger can use ON CONFLICT cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_defects_source_check_item
  ON public.defects(source_check_item_id)
  WHERE source_check_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_defects_source ON public.defects(source);

-- ---------------------------------------------------------------------------
-- 2. Trigger function: maintenance_check_items.result → defects
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_item_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_check    record;
  v_severity text;
  v_title    text;
BEGIN
  -- Only act on transitions to/from 'fail'. Other state changes (notes
  -- edits, completed_at updates, etc.) are noise.
  IF (TG_OP = 'INSERT' AND NEW.result = 'fail')
     OR (TG_OP = 'UPDATE' AND NEW.result = 'fail' AND COALESCE(OLD.result, '') <> 'fail')
  THEN
    -- Resolve the parent check so we can copy site/asset linkage onto
    -- the defect — keeps the defect filterable without an extra join.
    SELECT mc.tenant_id, mc.site_id
      INTO v_check
      FROM public.maintenance_checks mc
     WHERE mc.id = NEW.check_id;

    -- Severity rule: maintenance_check_items don't carry test category yet,
    -- so default to medium. ACB/NSX triggers (future) can pick low/high.
    v_severity := 'medium';

    -- Title takes a concise prefix + the check item description (truncated).
    v_title := 'Failed: ' || COALESCE(LEFT(NEW.description, 100), 'maintenance check item');

    INSERT INTO public.defects (
      tenant_id,
      check_id,
      check_asset_id,
      asset_id,
      site_id,
      title,
      description,
      severity,
      status,
      raised_by,
      source,
      source_check_item_id
    ) VALUES (
      v_check.tenant_id,
      NEW.check_id,
      NULL,        -- check_asset_id not directly tracked on items today
      NEW.asset_id,
      v_check.site_id,
      v_title,
      NEW.notes,   -- techs put failure context in the notes field
      v_severity,
      'open',
      NEW.completed_by,
      'auto_check_item',
      NEW.id
    )
    ON CONFLICT (source_check_item_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = CASE
                 -- Re-opening a previously-resolved auto defect when the
                 -- item is failed again — bring it back to 'open'.
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  -- Reverse path: an item that previously failed gets re-marked pass/na/null.
  -- Resolve the auto-defect rather than deleting — keeps the history.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.result, '') = 'fail'
     AND COALESCE(NEW.result, '') <> 'fail'
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolved_by = NEW.completed_by,
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source check item re-marked as ' || COALESCE(NEW.result, 'NULL') || '.',
           updated_at = now()
     WHERE source_check_item_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_check_item_to_defect() IS
  'Promotes failed maintenance_check_items into the defects register, and resolves the auto-created defect when the item is later un-failed.';

-- ---------------------------------------------------------------------------
-- 3. Wire the trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_check_item_to_defect ON public.maintenance_check_items;

CREATE TRIGGER trg_check_item_to_defect
  AFTER INSERT OR UPDATE OF result ON public.maintenance_check_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_check_item_to_defect();

COMMENT ON TRIGGER trg_check_item_to_defect ON public.maintenance_check_items IS
  'Sprint 3.2 (2026-04-26): auto-create defects on failed items, auto-resolve on reversal.';
