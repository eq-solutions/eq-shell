-- Add report_type column to report_deliveries so the new Work Order Details
-- generator can be distinguished from PM Check reports in the audit trail
-- and in any future UI filters.
--
-- Phase 2 of the 2026-04-23 Maximo report-parity build added a "Work Order
-- Details" option to SendReportModal and a dispatcher in
-- app/(app)/reports/actions.ts that writes `report_type` on the insert.
-- Without this column the insert fails at runtime as soon as a user picks
-- the new option.
--
-- Backfill: existing rows are PM check reports — set the default + backfill
-- so historical deliveries are correctly labelled.

ALTER TABLE public.report_deliveries
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'pm_check'
    CHECK (report_type IN ('pm_check', 'work_order_details'));

-- Backfill is implicit via DEFAULT, but make it explicit for clarity:
UPDATE public.report_deliveries
  SET report_type = 'pm_check'
  WHERE report_type IS NULL;

COMMENT ON COLUMN public.report_deliveries.report_type IS
  'Which report generator produced this delivery: pm_check (PM Check Report) or work_order_details (per-asset Maximo-parity Work Order Details).';
