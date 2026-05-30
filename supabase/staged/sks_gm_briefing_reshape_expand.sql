-- sks_gm_briefing_reshape_expand.sql   TARGET: ehowgjardagevnrluult (LIVE SKS)   GATE: 🔒🔒
--
-- PURPOSE: bring live SKS gm/briefing tables to EQ's 0024/0025 shape (tenant_id +
-- per-tenant period uniqueness). This is PARITY, not security — these tables are
-- already RLS-enabled / no-policy (deny-all) and read only via service-role Netlify
-- functions, so tenant_id is for data correctness + drift-gate parity, not a live gate.
--
-- PHASE 1 of 2 — EXPAND (this file): additive + invisible to the running app.
-- Adds tenant_id (nullable), backfills the single live tenant, and adds the
-- per-tenant unique index. KEEPS the existing UNIQUE(period_code) so the current
-- upload path (onConflict: 'period_code') keeps working unchanged. Safe to apply
-- any time. (gm_report_jobs needs no tenant_id — it inherits via period_id FK,
-- matching EQ's 0024.)
--
-- THEN: deploy the upload-gm-report.ts change (see sks_gm_briefing_reshape_contract.sql
-- header), smoke a GM upload, and only then apply PHASE 2 (contract).

BEGIN;

ALTER TABLE app_data.gm_report_periods ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app_data.briefing_cache    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app_data.briefing_actions  ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE app_data.gm_report_periods SET tenant_id = '7dee117c-98bd-4d39-af8c-2c81d02a1e85' WHERE tenant_id IS NULL;
UPDATE app_data.briefing_cache    SET tenant_id = '7dee117c-98bd-4d39-af8c-2c81d02a1e85' WHERE tenant_id IS NULL;
UPDATE app_data.briefing_actions  SET tenant_id = '7dee117c-98bd-4d39-af8c-2c81d02a1e85' WHERE tenant_id IS NULL;

-- Per-tenant uniqueness for the new onConflict target (coexists with UNIQUE(period_code)).
CREATE UNIQUE INDEX IF NOT EXISTS gm_report_periods_tenant_period_key
  ON app_data.gm_report_periods (tenant_id, period_code);

COMMIT;
