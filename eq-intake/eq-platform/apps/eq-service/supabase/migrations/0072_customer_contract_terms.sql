-- ============================================================
-- Migration 0068: Customer contract terms
--
-- Extends customers with the structured contract metadata surfaced by the
-- 2026-04-27 SKS / Equinix portfolio audit:
--   - Contract template (different shapes for AU SMCA, Hyperscale, etc.)
--   - CPI rule (simple-on-Y1-base for Equinix; not compound)
--   - Visit cadence (quarterly / biannual / monthly)
--   - SLA & reporting obligations (response, on-site, resolution times)
--   - Term + renewal options
--   - Payment terms
--   - Customer entity legal details (ABN for AU)
--   - Management hours per period (the standing supervisor allocation)
--   - References to the signed contract documents
--
-- All additive + nullable. Existing customer rows still validate.
-- ============================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS contract_template text
    CHECK (contract_template IS NULL OR contract_template IN (
      'au_smca_v1',           -- Equinix AU SMCA (CA1/SY1/SY2/SY3/SY6/SY7/AUHQ)
      'hyperscale_v1',        -- Equinix Hyperscale (SY9)
      'jemena_v1',            -- Jemena NSW
      'generic'
    )),
  ADD COLUMN IF NOT EXISTS customer_entity_legal_name text,
  ADD COLUMN IF NOT EXISTS customer_entity_abn        text,
  ADD COLUMN IF NOT EXISTS customer_entity_acn        text,
  ADD COLUMN IF NOT EXISTS smca_agreement_number      text,
  ADD COLUMN IF NOT EXISTS schedule_agreement_number  text,
  ADD COLUMN IF NOT EXISTS contract_term_start        date,
  ADD COLUMN IF NOT EXISTS contract_term_end          date,
  ADD COLUMN IF NOT EXISTS contract_options           text,        -- e.g. '+1+1'
  ADD COLUMN IF NOT EXISTS visit_cadence              text
    CHECK (visit_cadence IS NULL OR visit_cadence IN (
      'monthly',
      'quarterly',
      'biannual',
      'annual',
      'ad_hoc'
    )),
  ADD COLUMN IF NOT EXISTS cpi_basis                  text
    CHECK (cpi_basis IS NULL OR cpi_basis IN (
      'simple_on_y1_base',    -- Equinix AU SMCA: Y_n = Y1_base * (1 + rate*(n-1))
      'compound_annual',      -- standard compound: Y_n = Y1_base * (1+rate)^(n-1)
      'none'
    )),
  ADD COLUMN IF NOT EXISTS cpi_rate                   numeric(5,4) DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS payment_terms_days         integer,     -- e.g. 45 for Equinix Net 45
  ADD COLUMN IF NOT EXISTS hourly_rate_normal         numeric(10,2),
  ADD COLUMN IF NOT EXISTS hourly_rate_after_hours    numeric(10,2),
  ADD COLUMN IF NOT EXISTS hourly_rate_weekend        numeric(10,2),
  ADD COLUMN IF NOT EXISTS hourly_rate_public_holiday numeric(10,2),
  ADD COLUMN IF NOT EXISTS min_hours_after_hours      numeric(4,2) DEFAULT 4,
  ADD COLUMN IF NOT EXISTS min_hours_weekend          numeric(4,2) DEFAULT 4,
  ADD COLUMN IF NOT EXISTS hourly_rate_effective_from date,
  -- SLAs
  ADD COLUMN IF NOT EXISTS sla_response_minutes       integer,     -- 15 for Equinix Premium
  ADD COLUMN IF NOT EXISTS sla_onsite_hours           integer,     -- 2 for Equinix
  ADD COLUMN IF NOT EXISTS sla_resolution_hours       integer,     -- 24 for Equinix
  -- Reporting cadence
  ADD COLUMN IF NOT EXISTS monthly_report_due_day     integer
    CHECK (monthly_report_due_day IS NULL OR monthly_report_due_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS pm_reschedule_notice_days  integer DEFAULT 30,
  -- Service Credits (% of annual contract value)
  ADD COLUMN IF NOT EXISTS service_credit_pm_breach_pct      numeric(5,4),  -- 0.03 = 3%
  ADD COLUMN IF NOT EXISTS service_credit_reactive_breach_pct numeric(5,4), -- 0.05
  ADD COLUMN IF NOT EXISTS service_credit_spares_breach_pct   numeric(5,4), -- 0.05
  -- Standing allocations
  ADD COLUMN IF NOT EXISTS management_hours_per_period numeric(8,2), -- 80 hrs/quarter for Equinix
  ADD COLUMN IF NOT EXISTS management_period_basis    text
    CHECK (management_period_basis IS NULL OR management_period_basis IN ('quarterly', 'monthly', 'annual')),
  -- Document references
  ADD COLUMN IF NOT EXISTS smca_doc_id                uuid REFERENCES public.attachments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_doc_id            uuid REFERENCES public.attachments(id) ON DELETE SET NULL,
  -- Calendar fiscal year basis (Equinix uses calendar year, Jemena uses Aus FY)
  ADD COLUMN IF NOT EXISTS fiscal_year_basis          text DEFAULT 'au_fy'
    CHECK (fiscal_year_basis IS NULL OR fiscal_year_basis IN ('au_fy', 'calendar'));

COMMENT ON COLUMN public.customers.contract_template IS
  'Which contract template this customer is on. Drives derivation logic for year-fees, CPI, scope-coverage rules.';

COMMENT ON COLUMN public.customers.cpi_basis IS
  'How CPI is applied year-over-year. Equinix AU SMCA confirmed simple_on_y1_base by audit 2026-04-27 (Y_n = Y1*(1+0.05*(n-1))) — NOT compound.';

COMMENT ON COLUMN public.customers.visit_cadence IS
  'How often SKS attends this customer''s sites for routine maintenance. Drives the calendar coverage check at xlsx import.';

COMMENT ON COLUMN public.customers.management_hours_per_period IS
  'Standing supervisor / planner overhead allocation absorbed into the contract value, NOT scheduled to specific dates. Equinix = 80 hrs / quarter.';

COMMENT ON COLUMN public.customers.fiscal_year_basis IS
  'Whether contract years align to calendar year (Equinix: 1 Jan - 31 Dec) or Australian FY (1 Jul - 30 Jun, default).';

COMMENT ON COLUMN public.customers.monthly_report_due_day IS
  'Day of month by which the monthly performance report must be issued. Equinix = 7. Drives auto-report scheduling.';

-- Indexes
CREATE INDEX IF NOT EXISTS customers_contract_template_idx
  ON public.customers(contract_template)
  WHERE contract_template IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_smca_agreement_idx
  ON public.customers(smca_agreement_number)
  WHERE smca_agreement_number IS NOT NULL;
