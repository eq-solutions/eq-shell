-- ============================================================
-- Migration 0022: ACB Extended Fields
-- Add circuit breaker rating, poles, trip unit for ACB tests
-- ============================================================

-- Add missing columns to acb_tests table
ALTER TABLE IF EXISTS public.acb_tests
ADD COLUMN IF NOT EXISTS cb_rating varchar(50),
ADD COLUMN IF NOT EXISTS cb_poles varchar(10),
ADD COLUMN IF NOT EXISTS trip_unit varchar(100),
ADD COLUMN IF NOT EXISTS trip_settings_ir varchar(50),
ADD COLUMN IF NOT EXISTS trip_settings_isd varchar(50),
ADD COLUMN IF NOT EXISTS trip_settings_ii varchar(50),
ADD COLUMN IF NOT EXISTS trip_settings_ig varchar(50);

-- Add step tracking columns for workflow management
ALTER TABLE IF EXISTS public.acb_tests
ADD COLUMN IF NOT EXISTS step1_status varchar(20) DEFAULT 'pending' CHECK (step1_status IN ('pending', 'in_progress', 'complete')),
ADD COLUMN IF NOT EXISTS step2_status varchar(20) DEFAULT 'pending' CHECK (step2_status IN ('pending', 'in_progress', 'complete')),
ADD COLUMN IF NOT EXISTS step3_status varchar(20) DEFAULT 'pending' CHECK (step3_status IN ('pending', 'in_progress', 'complete'));
