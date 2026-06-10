-- ============================================================
-- Migration 0063: assigned_to on test tables
--
-- Sprint 1.3 follow-up (2026-04-26).
--
-- maintenance_checks already had assigned_to (from 0003). The dashboard's
-- "Assigned to Me" filter currently keys off that, which is fine for the
-- coarsest unit (the check). This adds the same column to the per-test-type
-- tables so the filter can drill below check level when needed:
--
--   acb_tests, nsx_tests, test_records → assigned_to uuid → auth.users
--
-- Why: a single maintenance check can wrap multiple tests, sometimes
-- assigned to different specialists (e.g. an electrician on the ACB tests
-- inside the check vs a tech on the visual inspection). Having assigned_to
-- on each test record means the dashboard "Assigned to Me" view can
-- include tests that are mine even when I'm not the assignee on the
-- parent check.
--
-- ON DELETE SET NULL: if a user is hard-deleted (super_admin only), the
-- assignment is cleared rather than the test row being lost.
-- ============================================================

ALTER TABLE public.acb_tests
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.nsx_tests
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.test_records
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.acb_tests.assigned_to IS
  'Specialist assigned to this ACB test. Independent of the parent maintenance_check.assigned_to so a single check can fan out work.';
COMMENT ON COLUMN public.nsx_tests.assigned_to IS
  'Specialist assigned to this NSX test. Independent of the parent maintenance_check.assigned_to.';
COMMENT ON COLUMN public.test_records.assigned_to IS
  'Specialist assigned to this generic test record. Independent of the parent maintenance_check.assigned_to.';

-- Filtered indexes — only the open work matters for the dashboard query.
-- IS NOT NULL keeps the index small (most rows have no assignee).
CREATE INDEX IF NOT EXISTS idx_acb_tests_assigned_to
  ON public.acb_tests(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nsx_tests_assigned_to
  ON public.nsx_tests(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_test_records_assigned_to
  ON public.test_records(assigned_to) WHERE assigned_to IS NOT NULL;
