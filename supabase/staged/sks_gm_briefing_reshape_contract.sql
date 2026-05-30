-- sks_gm_briefing_reshape_contract.sql   TARGET: ehowgjardagevnrluult (LIVE SKS)   GATE: 🔒🔒
--
-- PHASE 2 of 2 — CONTRACT. Apply ONLY after BOTH:
--   (a) sks_gm_briefing_reshape_expand.sql has run, AND
--   (b) the upload-gm-report.ts change below is DEPLOYED to core.eq.solutions and a
--       GM upload has been smoked (so every new row writes tenant_id).
--
-- ── REQUIRED CODE CHANGE (netlify/functions/upload-gm-report.ts), ship before this ──
-- The function already resolves the tenant via getTenantDataClientById(tenant_id),
-- so it HAS the tenant_id. Two edits to the gm_report_periods upsert:
--   1. include `tenant_id` in the upserted row object;
--   2. change `.upsert(row, { onConflict: 'period_code' })`
--           to `.upsert(row, { onConflict: 'tenant_id,period_code' })`.
-- (briefing_cache / briefing_actions writers: set tenant_id on insert too.)
--
-- After deploy + smoke, this phase enforces the new shape and retires the global key.

BEGIN;

ALTER TABLE app_data.gm_report_periods ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app_data.briefing_cache    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app_data.briefing_actions  ALTER COLUMN tenant_id SET NOT NULL;

-- Swap period uniqueness from global to per-tenant. Confirm the existing constraint
-- name first (default is gm_report_periods_period_code_key):
--   SELECT conname FROM pg_constraint
--   WHERE conrelid='app_data.gm_report_periods'::regclass AND contype='u';
ALTER TABLE app_data.gm_report_periods DROP CONSTRAINT gm_report_periods_period_code_key;
ALTER TABLE app_data.gm_report_periods
  ADD CONSTRAINT gm_report_periods_tenant_period_key UNIQUE USING INDEX gm_report_periods_tenant_period_key;

COMMIT;
