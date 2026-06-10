-- Migration 0058: Add Maximo work-order fields to check_assets and job_plan_items
--
-- Scope:
-- - Extends check_assets to capture Maximo WO metadata and inspection results
-- - Extends job_plan_items to link to Maximo task IDs
--
-- All new columns are nullable — existing checks and imports continue working.
-- Delta WO import will populate these fields when source data is present.

ALTER TABLE check_assets
  ADD COLUMN IF NOT EXISTS priority text DEFAULT NULL
    CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS work_type text DEFAULT NULL
    CHECK (work_type IS NULL OR work_type IN ('PM', 'CM', 'EM', 'CAL', 'INSP')),
  ADD COLUMN IF NOT EXISTS crew_id text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_start timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_finish timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS failure_code text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS problem text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cause text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS remedy text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS classification text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ir_scan_result text DEFAULT NULL
    CHECK (ir_scan_result IS NULL OR ir_scan_result IN ('pass', 'fail', 'na', 'not_done'));

-- Comments on new columns
COMMENT ON COLUMN check_assets.priority IS 'Maximo work order priority: low, medium, high, urgent';
COMMENT ON COLUMN check_assets.work_type IS 'Maximo work type: PM (preventive), CM (corrective), EM (emergency), CAL (calibration), INSP (inspection)';
COMMENT ON COLUMN check_assets.crew_id IS 'Maximo crew or resource identifier';
COMMENT ON COLUMN check_assets.target_start IS 'Maximo target start date/time';
COMMENT ON COLUMN check_assets.target_finish IS 'Maximo target completion date/time';
COMMENT ON COLUMN check_assets.failure_code IS 'Maximo failure classification code';
COMMENT ON COLUMN check_assets.problem IS 'Problem statement from Maximo WO';
COMMENT ON COLUMN check_assets.cause IS 'Root cause of the failure';
COMMENT ON COLUMN check_assets.remedy IS 'Remedy or corrective action taken';
COMMENT ON COLUMN check_assets.classification IS 'Maximo asset classification path (e.g. "ELEC \\ TRNSFMR")';
COMMENT ON COLUMN check_assets.ir_scan_result IS 'Infrared scan result: pass, fail, na (not applicable), not_done';

-- Add maximo_task_id to job_plan_items
ALTER TABLE job_plan_items
  ADD COLUMN IF NOT EXISTS maximo_task_id text DEFAULT NULL;

COMMENT ON COLUMN job_plan_items.maximo_task_id IS 'Link to Maximo task ID for cross-reference in reports; if null, sequential numbering is used in templates';
