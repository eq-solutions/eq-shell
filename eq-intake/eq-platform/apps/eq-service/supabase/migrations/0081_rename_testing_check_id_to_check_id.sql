-- =============================================================================
-- Migration 0081: Rename testing_check_id → check_id on acb_tests / nsx_tests
-- =============================================================================
--
-- Cleanup follow-up to migration 0080 (which merged testing_checks into
-- maintenance_checks). The column name testing_check_id is now misleading —
-- both columns reference maintenance_checks(id), not the dropped testing_checks
-- table. Renaming aligns with rcd_tests.check_id and removes the misnomer.
--
-- Constraints and indexes are also renamed so pg_dump output stays clean and
-- future engineers reading the schema don't get confused.
-- =============================================================================

-- ---------- acb_tests ----------
ALTER TABLE public.acb_tests
  RENAME COLUMN testing_check_id TO check_id;

ALTER TABLE public.acb_tests
  RENAME CONSTRAINT acb_tests_testing_check_id_fkey TO acb_tests_check_id_fkey;

ALTER INDEX IF EXISTS public.idx_acb_tests_testing_check       RENAME TO idx_acb_tests_check;
ALTER INDEX IF EXISTS public.idx_acb_tests_testing_check_id    RENAME TO idx_acb_tests_check_id;

-- ---------- nsx_tests ----------
ALTER TABLE public.nsx_tests
  RENAME COLUMN testing_check_id TO check_id;

ALTER TABLE public.nsx_tests
  RENAME CONSTRAINT nsx_tests_testing_check_id_fkey TO nsx_tests_check_id_fkey;

ALTER INDEX IF EXISTS public.idx_nsx_tests_testing_check       RENAME TO idx_nsx_tests_check;
ALTER INDEX IF EXISTS public.idx_nsx_tests_testing_check_id    RENAME TO idx_nsx_tests_check_id;
