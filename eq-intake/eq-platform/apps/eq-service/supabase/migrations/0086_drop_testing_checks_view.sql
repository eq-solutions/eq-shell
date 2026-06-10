-- =============================================================================
-- Migration 0086: Drop the testing_checks transition view
-- =============================================================================
--
-- Migration 0080 (2026-04-28) merged testing_checks into maintenance_checks
-- and replaced the table with a read-only view backed by maintenance_checks
-- WHERE kind IN ('acb','nsx','general'). The view existed during the
-- transition window so any code we missed kept working.
--
-- Audit on 2026-04-28: every `from('testing_checks')` call site has been
-- migrated to `from('maintenance_checks').in('kind', [...])`. Remaining
-- references in the codebase are documentation comments only — no runtime
-- reads or writes touch the view.
--
-- Drop the view. Future code that tries to read it gets a clean
-- "relation testing_checks does not exist" error instead of stale
-- semantics.
-- =============================================================================

DROP VIEW IF EXISTS public.testing_checks;
