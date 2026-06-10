-- ============================================================
-- Migration 0023: ACB Full Asset Collection Fields
-- Adds 22 columns to acb_tests for complete breaker identification,
-- trip unit & ratings, protection settings, and accessories —
-- matching the exact Excel test sheet layout.
-- NOTE: Already applied to Supabase production.
-- ============================================================

-- Breaker Identification
ALTER TABLE IF EXISTS public.acb_tests
ADD COLUMN IF NOT EXISTS brand varchar(100),
ADD COLUMN IF NOT EXISTS breaker_type varchar(100),
ADD COLUMN IF NOT EXISTS name_location varchar(200),
ADD COLUMN IF NOT EXISTS performance_level varchar(10) CHECK (performance_level IS NULL OR performance_level IN ('N1', 'H1', 'H2', 'H3', 'L1')),
ADD COLUMN IF NOT EXISTS protection_unit_fitted boolean,
ADD COLUMN IF NOT EXISTS trip_unit_model varchar(100),
ADD COLUMN IF NOT EXISTS current_in varchar(50),
ADD COLUMN IF NOT EXISTS fixed_withdrawable varchar(20) CHECK (fixed_withdrawable IS NULL OR fixed_withdrawable IN ('Fixed', 'Withdrawable'));

-- Protection Settings
ALTER TABLE IF EXISTS public.acb_tests
ADD COLUMN IF NOT EXISTS long_time_ir varchar(50),
ADD COLUMN IF NOT EXISTS long_time_delay_tr varchar(50),
ADD COLUMN IF NOT EXISTS short_time_pickup_isd varchar(50),
ADD COLUMN IF NOT EXISTS short_time_delay_tsd varchar(50),
ADD COLUMN IF NOT EXISTS instantaneous_pickup varchar(50),
ADD COLUMN IF NOT EXISTS earth_fault_pickup varchar(50),
ADD COLUMN IF NOT EXISTS earth_fault_delay varchar(50),
ADD COLUMN IF NOT EXISTS earth_leakage_pickup varchar(50),
ADD COLUMN IF NOT EXISTS earth_leakage_delay varchar(50);

-- Accessories
ALTER TABLE IF EXISTS public.acb_tests
ADD COLUMN IF NOT EXISTS motor_charge varchar(50),
ADD COLUMN IF NOT EXISTS shunt_trip_mx1 varchar(50),
ADD COLUMN IF NOT EXISTS shunt_close_xf varchar(50),
ADD COLUMN IF NOT EXISTS undervoltage_mn varchar(50),
ADD COLUMN IF NOT EXISTS second_shunt_trip varchar(50);
