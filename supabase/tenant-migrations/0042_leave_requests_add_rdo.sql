-- Migration: 0042_leave_requests_add_rdo
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Add 'rdo' to the app_data.leave_requests.leave_type CHECK so RDO
--            leave is first-class (it was mapped to 'other' + a lossless carrier).
--
-- WHY (live-verified): SKS has 28 RDO leave rows. app_data.schedule_entries.leave_type
--   ALREADY includes 'rdo'; leave_requests.leave_type did not — an asymmetry. Adding
--   it lets the leave adapter + ETL map RDO -> 'rdo' directly (queryable), instead of
--   RDO -> 'other' + a verbatim carrier in `reason`.
--
-- Safe: adding a value to the allowed set is a relaxation — it cannot violate any
--   existing row. Idempotent via DROP CONSTRAINT IF EXISTS + recreate.
-- The runner records the ledger row on apply; this file writes no ledger row.

ALTER TABLE app_data.leave_requests DROP CONSTRAINT IF EXISTS leave_request_type_check;
ALTER TABLE app_data.leave_requests ADD CONSTRAINT leave_request_type_check
  CHECK (leave_type = ANY (ARRAY['annual','sick','personal','long_service','unpaid','tafe','rdo','other']));
