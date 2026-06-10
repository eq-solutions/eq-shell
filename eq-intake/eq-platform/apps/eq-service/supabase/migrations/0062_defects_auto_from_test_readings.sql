-- ============================================================
-- Migration 0062: Defects auto-population from ACB / NSX / generic test readings
--
-- Sprint 3.2 follow-up (2026-04-26).
--
-- The maintenance_check_items trigger from 0061 covers the checklist path.
-- This adds the equivalent for the three test-readings tables:
--
--   acb_test_readings    (per-reading is_pass)
--   nsx_test_readings    (per-reading is_pass)
--   test_record_readings (per-reading pass)
--
-- Severity rule (per Royce 26-Apr): infer test category from the reading
-- label, since the schema has no explicit category column:
--
--   Visual     → low     (label matches: visual, inspection, corrosion,
--                         damage, cleanliness, placard, label, condition,
--                         tightness, contamination, signage, lighting)
--   Functional → medium  (label matches: operation, mechanism, auxiliary,
--                         spring, charge, open, close, rack, motor,
--                         interlock, manual, function)
--   Electrical → high    (label matches: insulation, ir, contact resistance,
--                         trip, injection, voltage, current, resistance,
--                         amp, volt, primary, secondary, earth, leakage,
--                         continuity)
--   Default    → medium
--
-- Same auto/reverse semantics as 0061: failed reading → defect, un-failed
-- reading → resolved defect (preserved for audit). Source-uniqueness
-- prevents duplicate defects on repeated edits.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Source pointer columns + indexes
-- ---------------------------------------------------------------------------
-- defects.source already accepts 'auto_acb_test' / 'auto_nsx_test' /
-- 'auto_general_test' from migration 0061. Add the back-pointer columns
-- so the reverse-on-pass flow can locate the right defect.

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS source_acb_reading_id uuid REFERENCES public.acb_test_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_nsx_reading_id uuid REFERENCES public.nsx_test_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_test_record_reading_id uuid REFERENCES public.test_record_readings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_defects_source_acb_reading
  ON public.defects(source_acb_reading_id)
  WHERE source_acb_reading_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_defects_source_nsx_reading
  ON public.defects(source_nsx_reading_id)
  WHERE source_nsx_reading_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_defects_source_test_record_reading
  ON public.defects(source_test_record_reading_id)
  WHERE source_test_record_reading_id IS NOT NULL;

COMMENT ON COLUMN public.defects.source_acb_reading_id IS
  'Back-pointer to the ACB reading that failed. Drives reverse-on-pass.';
COMMENT ON COLUMN public.defects.source_nsx_reading_id IS
  'Back-pointer to the NSX reading that failed. Drives reverse-on-pass.';
COMMENT ON COLUMN public.defects.source_test_record_reading_id IS
  'Back-pointer to the generic test_records reading that failed. Drives reverse-on-pass.';

-- ---------------------------------------------------------------------------
-- 2. Severity helper — pure function so all three triggers share one rule
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_severity_from_reading_label(label text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  l text;
BEGIN
  l := lower(coalesce(label, ''));

  -- Electrical patterns first (most-specific). High severity.
  IF l ~ '(insulation|^ir\s|^ir$|contact\s*resistance|trip\s*test|injection|primary|secondary|earth\s*(leakage|fault)|continuity|micro-?ohm|m\s*?ohm|kv\s*test|hipot|leakage\s*current|breaker\s*test)'
  THEN RETURN 'high';
  END IF;

  -- Functional patterns. Medium.
  IF l ~ '(operation|mechanism|auxiliary|spring|charge|open\s*close|opening|closing|rack|motor|interlock|manual\s*operation|function|trip\s*free)'
  THEN RETURN 'medium';
  END IF;

  -- Visual patterns. Low.
  -- Note: bare 'label' was dropped (post-deploy fix 26-Apr) — too generic,
  -- matched arbitrary "Some unknown label" text. 'placard' / 'warning label'
  -- / 'signage' cover the real visual-inspection labels we care about.
  IF l ~ '(visual|inspection|corrosion|damage|cleanliness|placard|warning\s*label|condition|tightness|contamination|signage|lighting|scratch|paint|finish)'
  THEN RETURN 'low';
  END IF;

  -- Unknown — default to medium so it's at least surfaced.
  RETURN 'medium';
END;
$$;

COMMENT ON FUNCTION public.fn_severity_from_reading_label(text) IS
  'Heuristic: maps a reading label to defect severity using regex keywords. Visual=low, Functional=medium, Electrical=high. Default medium.';

-- ---------------------------------------------------------------------------
-- 3. ACB readings → defects
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_acb_reading_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_test     record;
  v_severity text;
  v_title    text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_pass = false)
     OR (TG_OP = 'UPDATE' AND NEW.is_pass = false AND COALESCE(OLD.is_pass, true) <> false)
  THEN
    SELECT t.tenant_id, t.asset_id, t.site_id
      INTO v_test
      FROM public.acb_tests t
     WHERE t.id = NEW.acb_test_id;

    v_severity := public.fn_severity_from_reading_label(NEW.label);
    v_title := 'ACB failed: ' || COALESCE(LEFT(NEW.label, 100), 'reading');

    INSERT INTO public.defects (
      tenant_id, asset_id, site_id, title, description, severity, status,
      source, source_acb_reading_id
    ) VALUES (
      v_test.tenant_id, v_test.asset_id, v_test.site_id, v_title,
      'Reading "' || NEW.label || '" = ' || COALESCE(NEW.value, '?') || ' ' || COALESCE(NEW.unit, '') || ' (failed)',
      v_severity, 'open', 'auto_acb_test', NEW.id
    )
    ON CONFLICT (source_acb_reading_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      status = CASE
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_pass, true) = false
     AND COALESCE(NEW.is_pass, true) <> false
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source ACB reading flipped to pass.',
           updated_at = now()
     WHERE source_acb_reading_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acb_reading_to_defect ON public.acb_test_readings;
CREATE TRIGGER trg_acb_reading_to_defect
  AFTER INSERT OR UPDATE OF is_pass ON public.acb_test_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_acb_reading_to_defect();

-- ---------------------------------------------------------------------------
-- 4. NSX readings → defects (mirrors ACB)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nsx_reading_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_test     record;
  v_severity text;
  v_title    text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_pass = false)
     OR (TG_OP = 'UPDATE' AND NEW.is_pass = false AND COALESCE(OLD.is_pass, true) <> false)
  THEN
    SELECT t.tenant_id, t.asset_id, t.site_id
      INTO v_test
      FROM public.nsx_tests t
     WHERE t.id = NEW.nsx_test_id;

    v_severity := public.fn_severity_from_reading_label(NEW.label);
    v_title := 'NSX failed: ' || COALESCE(LEFT(NEW.label, 100), 'reading');

    INSERT INTO public.defects (
      tenant_id, asset_id, site_id, title, description, severity, status,
      source, source_nsx_reading_id
    ) VALUES (
      v_test.tenant_id, v_test.asset_id, v_test.site_id, v_title,
      'Reading "' || NEW.label || '" = ' || COALESCE(NEW.value, '?') || ' ' || COALESCE(NEW.unit, '') || ' (failed)',
      v_severity, 'open', 'auto_nsx_test', NEW.id
    )
    ON CONFLICT (source_nsx_reading_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      status = CASE
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_pass, true) = false
     AND COALESCE(NEW.is_pass, true) <> false
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source NSX reading flipped to pass.',
           updated_at = now()
     WHERE source_nsx_reading_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nsx_reading_to_defect ON public.nsx_test_readings;
CREATE TRIGGER trg_nsx_reading_to_defect
  AFTER INSERT OR UPDATE OF is_pass ON public.nsx_test_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_nsx_reading_to_defect();

-- ---------------------------------------------------------------------------
-- 5. Generic test_record readings → defects
--    NB: test_record_readings uses column name 'pass' (not 'is_pass').
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_test_record_reading_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_test     record;
  v_severity text;
  v_title    text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.pass = false)
     OR (TG_OP = 'UPDATE' AND NEW.pass = false AND COALESCE(OLD.pass, true) <> false)
  THEN
    SELECT t.tenant_id, t.asset_id, t.site_id
      INTO v_test
      FROM public.test_records t
     WHERE t.id = NEW.test_record_id;

    v_severity := public.fn_severity_from_reading_label(NEW.label);
    v_title := 'Test failed: ' || COALESCE(LEFT(NEW.label, 100), 'reading');

    INSERT INTO public.defects (
      tenant_id, asset_id, site_id, title, description, severity, status,
      source, source_test_record_reading_id
    ) VALUES (
      v_test.tenant_id, v_test.asset_id, v_test.site_id, v_title,
      'Reading "' || NEW.label || '" = ' || COALESCE(NEW.value, '?') || ' ' || COALESCE(NEW.unit, '') || ' (failed)',
      v_severity, 'open', 'auto_general_test', NEW.id
    )
    ON CONFLICT (source_test_record_reading_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      status = CASE
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.pass, true) = false
     AND COALESCE(NEW.pass, true) <> false
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source test reading flipped to pass.',
           updated_at = now()
     WHERE source_test_record_reading_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_test_record_reading_to_defect ON public.test_record_readings;
CREATE TRIGGER trg_test_record_reading_to_defect
  AFTER INSERT OR UPDATE OF pass ON public.test_record_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_test_record_reading_to_defect();
