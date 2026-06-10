-- ============================================================
-- Migration 0026: NSX Workflow — mirror ACB 3-step workflow
-- Adds step1_status / step2_status / step3_status and extended
-- asset-collection fields to nsx_tests so the NSX testing page
-- can follow the same 3-step pattern as ACB.
-- ============================================================

ALTER TABLE public.nsx_tests
  ADD COLUMN IF NOT EXISTS step1_status  varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (step1_status IN ('pending', 'in_progress', 'complete')),
  ADD COLUMN IF NOT EXISTS step2_status  varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (step2_status IN ('pending', 'in_progress', 'complete')),
  ADD COLUMN IF NOT EXISTS step3_status  varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (step3_status IN ('pending', 'in_progress', 'complete'));

-- Extended asset-collection fields (mirror of ACB 0022/0023)
ALTER TABLE public.nsx_tests
  ADD COLUMN IF NOT EXISTS brand                 varchar(100),
  ADD COLUMN IF NOT EXISTS breaker_type          varchar(100),
  ADD COLUMN IF NOT EXISTS name_location         varchar(200),
  ADD COLUMN IF NOT EXISTS current_in            varchar(50),
  ADD COLUMN IF NOT EXISTS fixed_withdrawable    varchar(20)
    CHECK (fixed_withdrawable IS NULL OR fixed_withdrawable IN ('fixed', 'withdrawable', 'plug_in')),
  ADD COLUMN IF NOT EXISTS protection_unit_fitted boolean,
  ADD COLUMN IF NOT EXISTS trip_unit_model       varchar(100),
  -- Protection settings
  ADD COLUMN IF NOT EXISTS long_time_ir          varchar(50),
  ADD COLUMN IF NOT EXISTS long_time_delay_tr    varchar(50),
  ADD COLUMN IF NOT EXISTS short_time_pickup_isd varchar(50),
  ADD COLUMN IF NOT EXISTS short_time_delay_tsd  varchar(50),
  ADD COLUMN IF NOT EXISTS instantaneous_pickup  varchar(50),
  ADD COLUMN IF NOT EXISTS earth_fault_pickup    varchar(50),
  ADD COLUMN IF NOT EXISTS earth_fault_delay     varchar(50),
  -- Accessories
  ADD COLUMN IF NOT EXISTS motor_charge          varchar(50),
  ADD COLUMN IF NOT EXISTS shunt_trip_mx1        varchar(50),
  ADD COLUMN IF NOT EXISTS shunt_close_xf        varchar(50),
  ADD COLUMN IF NOT EXISTS undervoltage_mn       varchar(50);

-- Helpful index for workflow lookups
CREATE INDEX IF NOT EXISTS idx_nsx_tests_asset_active
  ON public.nsx_tests(asset_id) WHERE is_active = true;
