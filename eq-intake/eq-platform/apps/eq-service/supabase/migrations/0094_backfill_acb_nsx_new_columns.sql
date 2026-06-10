-- ============================================================
-- Migration 0094: Bidirectional backfill of ACB/NSX breaker columns
-- ============================================================
--
-- PURPOSE
-- -------
-- The acb_tests and nsx_tests tables carry two parallel column sets for
-- breaker identification because the 3-step canonical workflow and the
-- legacy bulk-edit form wrote to different columns:
--
--   Legacy  : cb_make,  cb_model,      cb_rating,  trip_unit
--   New     : brand,    breaker_type,  current_in, trip_unit_model
--
-- (cb_serial and cb_poles are shared — both surfaces wrote to the same
-- column name, so they don't need backfill.)
--
-- Audit #101 (2026-05-13, severity HIGH) found that the customer report
-- only read the LEGACY columns, so breakers entered via the canonical
-- workflow rendered as "—" in the PDF. PR #111 added a `new ?? legacy`
-- fallback in the report builders as a stopgap; this migration is the
-- structural fix.
--
-- BIDIRECTIONAL
-- -------------
-- Pre-flight data review (2026-05-14) showed:
--   - acb_tests: 0 rows need legacy→new; 1 row needs new→legacy
--   - nsx_tests: 0 rows need legacy→new; 12 rows need new→legacy
-- So the real-world gap is in the new→legacy direction. This migration
-- runs BOTH directions so the table ends up with mirrored values
-- regardless of which entry path created the row.
--
-- The migration is idempotent: each UPDATE is guarded by `WHERE target IS
-- NULL AND source IS NOT NULL` so re-running is a no-op. Neither
-- direction overwrites populated values.
--
-- After this migration the application's mirror helper
-- (lib/utils/breaker-cols.ts) keeps both column sets in sync on every
-- subsequent write, so the fallback in the report builders becomes
-- defensive rather than load-bearing.
--
-- ROLLBACK STRATEGY
-- -----------------
-- All writes fill previously-null cells. Nothing is overwritten or
-- deleted. To roll back, revert the code changes in the same PR — the
-- pre-migration values are still present in their original columns.
-- A subsequent migration (not this one) will drop the legacy columns
-- once Royce has verified backfill quality against real customer data.
-- ============================================================

-- ============================================================
-- Direction 1: LEGACY -> NEW (covers rows entered via bulk-edit form)
-- ============================================================

-- acb_tests
UPDATE public.acb_tests
   SET brand = cb_make
 WHERE brand IS NULL
   AND cb_make IS NOT NULL;

UPDATE public.acb_tests
   SET breaker_type = cb_model
 WHERE breaker_type IS NULL
   AND cb_model IS NOT NULL;

UPDATE public.acb_tests
   SET current_in = cb_rating
 WHERE current_in IS NULL
   AND cb_rating IS NOT NULL;

UPDATE public.acb_tests
   SET trip_unit_model = trip_unit
 WHERE trip_unit_model IS NULL
   AND trip_unit IS NOT NULL;

-- nsx_tests
UPDATE public.nsx_tests
   SET brand = cb_make
 WHERE brand IS NULL
   AND cb_make IS NOT NULL;

UPDATE public.nsx_tests
   SET breaker_type = cb_model
 WHERE breaker_type IS NULL
   AND cb_model IS NOT NULL;

UPDATE public.nsx_tests
   SET current_in = cb_rating
 WHERE current_in IS NULL
   AND cb_rating IS NOT NULL;

UPDATE public.nsx_tests
   SET trip_unit_model = trip_unit
 WHERE trip_unit_model IS NULL
   AND trip_unit IS NOT NULL;

-- ============================================================
-- Direction 2: NEW -> LEGACY (covers rows entered via 3-step workflow)
-- Per pre-flight: 1 acb row + 12 nsx rows. These are the audit #101
-- problem rows — without this backfill they rely on the report builders'
-- `new ?? legacy` fallback forever.
-- ============================================================

-- acb_tests
UPDATE public.acb_tests
   SET cb_make = brand
 WHERE cb_make IS NULL
   AND brand IS NOT NULL;

UPDATE public.acb_tests
   SET cb_model = breaker_type
 WHERE cb_model IS NULL
   AND breaker_type IS NOT NULL;

UPDATE public.acb_tests
   SET cb_rating = current_in
 WHERE cb_rating IS NULL
   AND current_in IS NOT NULL;

UPDATE public.acb_tests
   SET trip_unit = trip_unit_model
 WHERE trip_unit IS NULL
   AND trip_unit_model IS NOT NULL;

-- nsx_tests
UPDATE public.nsx_tests
   SET cb_make = brand
 WHERE cb_make IS NULL
   AND brand IS NOT NULL;

UPDATE public.nsx_tests
   SET cb_model = breaker_type
 WHERE cb_model IS NULL
   AND breaker_type IS NOT NULL;

UPDATE public.nsx_tests
   SET cb_rating = current_in
 WHERE cb_rating IS NULL
   AND current_in IS NOT NULL;

UPDATE public.nsx_tests
   SET trip_unit = trip_unit_model
 WHERE trip_unit IS NULL
   AND trip_unit_model IS NOT NULL;
