-- Add code and type columns to job_plans
ALTER TABLE job_plans ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE job_plans ADD COLUMN IF NOT EXISTS type TEXT;

-- Make frequency nullable (frequency now lives on items, not plans)
ALTER TABLE job_plans ALTER COLUMN frequency DROP NOT NULL;
ALTER TABLE job_plans ALTER COLUMN frequency SET DEFAULT NULL;

-- Add frequency flags to job_plan_items
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS dark_site BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_monthly BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_quarterly BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_semi_annual BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_annual BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_2yr BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_3yr BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_5yr BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_8yr BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_plan_items ADD COLUMN IF NOT EXISTS freq_10yr BOOLEAN NOT NULL DEFAULT false;

-- Index for lookup by code within a tenant
CREATE INDEX IF NOT EXISTS idx_job_plans_code ON job_plans (tenant_id, code) WHERE code IS NOT NULL;
