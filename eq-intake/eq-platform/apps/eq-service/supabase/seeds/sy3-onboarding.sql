-- ============================================================
-- SY3 bootstrap seed — generated 2026-04-27T10:10:04
-- 
-- Targets eq-solves-service Supabase post migrations 0068-0073.
-- Idempotent within a single run (DO block with lookup-or-create).
-- Re-running will REPLACE existing 2026 contract scopes + calendar
-- entries for SY3 + their gap rows. Customer + site UPSERTed.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id   uuid;
  v_customer_id uuid;
  v_site_id     uuid;
  v_scope_id    uuid;
BEGIN

  -- ---- Resolve SKS tenant ----
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'sks';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'SKS tenant not found - aborting';
  END IF;

  -- ---- Upsert Equinix Australia customer ----
  SELECT id INTO v_customer_id FROM public.customers
    WHERE tenant_id = v_tenant_id AND smca_agreement_number = '263389';
  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      tenant_id, name, code,
      contract_template, customer_entity_legal_name, customer_entity_abn,
      smca_agreement_number, schedule_agreement_number,
      contract_term_start, contract_term_end, contract_options,
      visit_cadence, cpi_basis, cpi_rate,
      payment_terms_days,
      hourly_rate_normal, hourly_rate_after_hours, hourly_rate_weekend, hourly_rate_public_holiday,
      min_hours_after_hours, min_hours_weekend,
      hourly_rate_effective_from,
      sla_response_minutes, sla_onsite_hours, sla_resolution_hours,
      monthly_report_due_day, pm_reschedule_notice_days,
      service_credit_pm_breach_pct, service_credit_reactive_breach_pct, service_credit_spares_breach_pct,
      management_hours_per_period, management_period_basis,
      fiscal_year_basis
    ) VALUES (
      v_tenant_id, 'Equinix Australia Pty Ltd', 'EQX-AU-SMCA',
      'au_smca_v1', 'Equinix Australia Pty Limited', '25 092 807 264',
      '263389', '263598',
      '2026-01-01', '2028-12-31', '+1+1',
      'quarterly', 'simple_on_y1_base', 0.05,
      45,
      125, 160, 180, 180,
      4, 4,
      '2025-12-17',
      15, 2, 24,
      7, 30,
      0.03, 0.05, 0.05,
      80, 'quarterly',
      'calendar'
    ) RETURNING id INTO v_customer_id;
    RAISE NOTICE 'Created customer: %', v_customer_id;
  ELSE
    -- Update with the contract metadata in case it has been backfilled
    UPDATE public.customers SET
      contract_template = 'au_smca_v1',
      customer_entity_legal_name = 'Equinix Australia Pty Limited',
      customer_entity_abn = '25 092 807 264',
      schedule_agreement_number = '263598',
      contract_term_start = '2026-01-01',
      contract_term_end = '2028-12-31',
      contract_options = '+1+1',
      visit_cadence = 'quarterly',
      cpi_basis = 'simple_on_y1_base',
      cpi_rate = 0.05,
      payment_terms_days = 45,
      hourly_rate_normal = 125, hourly_rate_after_hours = 160,
      hourly_rate_weekend = 180, hourly_rate_public_holiday = 180,
      min_hours_after_hours = 4, min_hours_weekend = 4,
      hourly_rate_effective_from = '2025-12-17',
      sla_response_minutes = 15, sla_onsite_hours = 2, sla_resolution_hours = 24,
      monthly_report_due_day = 7, pm_reschedule_notice_days = 30,
      service_credit_pm_breach_pct = 0.03,
      service_credit_reactive_breach_pct = 0.05,
      service_credit_spares_breach_pct = 0.05,
      management_hours_per_period = 80,
      management_period_basis = 'quarterly',
      fiscal_year_basis = 'calendar'
    WHERE id = v_customer_id;
    RAISE NOTICE 'Updated existing customer: %', v_customer_id;
  END IF;

  -- ---- Upsert SY3 site ----
  SELECT id INTO v_site_id FROM public.sites
    WHERE tenant_id = v_tenant_id AND customer_id = v_customer_id AND code = 'SY3';
  IF v_site_id IS NULL THEN
    INSERT INTO public.sites (tenant_id, customer_id, name, code, address)
    VALUES (v_tenant_id, v_customer_id, 'SY3', 'SY3', '47 Bourke Rd Alexandria NSW')
    RETURNING id INTO v_site_id;
    RAISE NOTICE 'Created site: %', v_site_id;
  ELSE
    RAISE NOTICE 'Found existing site: %', v_site_id;
  END IF;

  -- ---- Wipe prior 2026 SY3 bootstrap data (safe for re-run) ----
  -- pm_calendar seeding was removed 2026-05-19 (see comment at end of file).
  DELETE FROM public.scope_coverage_gaps WHERE customer_id = v_customer_id AND contract_year = 2026;
  DELETE FROM public.contract_scopes
    WHERE customer_id = v_customer_id AND site_id = v_site_id AND financial_year = '2026';

  -- ---- Contract scopes (16 priced JPs + 3 additional items) ----
  -- JP E1.3 - PDU - Power Distribution Units
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'PDU - Power Distribution Units', true,
    'E1.3', 76, 'A', 'fixed',
    '{"1YR": 125.0}'::jsonb, '{"2026": 9500.0, "2027": 9500.0, "2028": 9500.0, "2029": 9500.0, "2030": 9500.0}'::jsonb, '{}'::jsonb,
    '{"A": 1.0}'::jsonb,
    NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 14, now(), 'committed'
  );

  -- JP E1.8 - ATS-Automatic Transfer Switches
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'ATS-Automatic Transfer Switches', true,
    'E1.8', 4, 'A; 3', 'fixed',
    '{"1YR": 500.0, "3YR": 1000.0}'::jsonb, '{"2026": 2000.0, "2027": 2000.0, "2028": 4000.0, "2029": 2000.0, "2030": 2000.0}'::jsonb, '{"2028": 0}'::jsonb,
    '{"A": 4.0, "3YR": 8.0}'::jsonb,
    '3YR due in 2028.',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 30, now(), 'committed'
  );

  -- JP E1.9 - General LV Switchboard Maintenances
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'General LV Switchboard Maintenances', true,
    'E1.9', 32, 'A; 5', 'fixed',
    '{"1YR": 250.0, "5YR": 1250.0}'::jsonb, '{"2026": 22000.0, "2027": 11000.0, "2028": 23000.0, "2029": 8000.0, "2030": 8000.0}'::jsonb, '{"2026": 14, "2027": 3, "2028": 15}'::jsonb,
    '{"A": 2.0, "5YR": 10.0}'::jsonb,
    '5YR:14 due in 2026,3 due in 2027,15 due in 2028.',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 32, now(), 'committed'
  );

  -- JP E1.12 - Electrical Panel w/o BCM
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Electrical Panel w/o BCM', true,
    'E1.12', 154, '5', 'fixed',
    '{"5YR": 125.0}'::jsonb, '{"2026": 0.0, "2027": 19250.0, "2028": 0.0, "2029": 0.0, "2030": 0.0}'::jsonb, '{"2027": 0}'::jsonb,
    '{"5YR": 1.0}'::jsonb,
    '5YR: due in 2027',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 34, now(), 'committed'
  );

  -- JP E1.14 - Electrical Panel w/BCM
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Electrical Panel w/BCM', true,
    'E1.14', 370, '5', 'fixed',
    '{"5YR": 125.0}'::jsonb, '{"2026": 0.0, "2027": 46250.0, "2028": 0.0, "2029": 0.0, "2030": 0.0}'::jsonb, '{"2027": 0}'::jsonb,
    '{"5YR": 1.0}'::jsonb,
    '5YR: due in 2027',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 36, now(), 'committed'
  );

  -- JP E1.17 - MSB/HDP - Load Transferring Switchboard Maintenance
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'MSB/HDP - Load Transferring Switchboard Maintenance', true,
    'E1.17', 14, 'A; 5', 'fixed',
    '{"1YR": 500.0, "5YR": 2500.0}'::jsonb, '{"2026": 7000.0, "2027": 7000.0, "2028": 35000.0, "2029": 7000.0, "2030": 7000.0}'::jsonb, '{"2028": 0}'::jsonb,
    '{"A": 4.0, "5YR": 20.0}'::jsonb,
    '5YR due in 2028.',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 43, now(), 'committed'
  );

  -- JP E1.18 - MV Switchboard Maintenance
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'MV Switchboard Maintenance', true,
    'E1.18', 9, 'A; 5', 'fixed',
    '{"1YR": 750.0, "5YR": 3750.0}'::jsonb, '{"2026": 30750.0, "2027": 6750.0, "2028": 9750.0, "2029": 6750.0, "2030": 6750.0}'::jsonb, '{"2026": 0, "2028": 0}'::jsonb,
    '{"A": 6.0, "5YR": 30.0}'::jsonb,
    '5YR: 8 assets due in 2026. 1 asset due in 2028.',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 45, now(), 'committed'
  );

  -- JP E1.24 - HV/LV Cast Resin Transformer (AN/AF)
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'HV/LV Cast Resin Transformer (AN/AF)', true,
    'E1.24', 14, 'A; 5', 'fixed',
    '{"1YR": 250.0, "5YR": 1000.0}'::jsonb, '{"2026": 3500.0, "2027": 3500.0, "2028": 3500.0, "2029": 3500.0, "2030": 14000.0}'::jsonb, '{"2030": 0}'::jsonb,
    '{"A": 2.0, "5YR": 8.0}'::jsonb,
    '5YR due in 2030.',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 55, now(), 'committed'
  );

  -- JP E1.25 - Low Voltage Air Circuit Breaker (ACB)
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Low Voltage Air Circuit Breaker (ACB)', true,
    'E1.25', 171, '5', 'fixed',
    '{"5YR": 562.5}'::jsonb, '{"2026": 0.0, "2027": 0.0, "2028": 96187.5, "2029": 0.0, "2030": 0.0}'::jsonb, '{"2028": 0}'::jsonb,
    '{"5YR": 4.5}'::jsonb,
    '5YR due in 2028.',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 60, now(), 'committed'
  );

  -- JP E1.33 - Comprehensive Utility Failure Test (to be quoted as required
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Comprehensive Utility Failure Test (to be quoted as required)', true,
    'E1.33', 1, 'A', 'fixed',
    '{}'::jsonb, '{"2026": 0.0, "2027": 0.0, "2028": 0.0, "2029": 0.0, "2030": 0.0}'::jsonb, '{}'::jsonb,
    '{}'::jsonb,
    NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 74, now(), 'committed'
  );

  -- JP E1.36 - Earthing System
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Earthing System', true,
    'E1.36', 1, '2', 'fixed',
    '{"2YR": 500.0}'::jsonb, '{"2026": 500.0, "2027": 0.0, "2028": 500.0, "2029": 0.0, "2030": 500.0}'::jsonb, '{"2026": 0, "2028": 0, "2030": 0}'::jsonb,
    '{"2YR": 4.0}'::jsonb,
    '2YR: due in 2026,2028&2030',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 78, now(), 'committed'
  );

  -- JP E1.39 - Fall of Potential Testing
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Fall of Potential Testing', true,
    'E1.39', 1, '5', 'fixed',
    '{"5YR": 1250.0}'::jsonb, '{"2026": 0.0, "2027": 0.0, "2028": 0.0, "2029": 1250.0, "2030": 0.0}'::jsonb, '{"2029": 0}'::jsonb,
    '{"5YR": 10.0}'::jsonb,
    '5YR due in 2029.',
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 82, now(), 'committed'
  );

  -- JP M10.13 - Emergency Back Up Lighting
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Emergency Back Up Lighting', true,
    'M10.13', 1, 'M/Q/A', 'fixed',
    '{"1YR": 1625.0}'::jsonb, '{"2026": 1625.0, "2027": 1625.0, "2028": 1625.0, "2029": 1625.0, "2030": 1625.0}'::jsonb, '{}'::jsonb,
    '{"M": 1.0, "Q": 4.0, "A": 8.0}'::jsonb,
    NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 88, now(), 'committed'
  );

  -- JP M14.21 - Lightning Protection
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Lightning Protection', true,
    'M14.21', 1, 'A', 'fixed',
    '{"1YR": 1750.0}'::jsonb, '{"2026": 1750.0, "2027": 1750.0, "2028": 1750.0, "2029": 1750.0, "2030": 1750.0}'::jsonb, '{}'::jsonb,
    '{"A": 14.0}'::jsonb,
    NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 92, now(), 'committed'
  );

  -- JP M14.29 - Lighting Control Panels
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Lighting Control Panels', true,
    'M14.29', 1, 'Q', 'fixed',
    '{"1YR": 1000.0}'::jsonb, '{"2026": 1000.0, "2027": 1000.0, "2028": 1000.0, "2029": 1000.0, "2030": 1000.0}'::jsonb, '{}'::jsonb,
    '{"Q": 8.0}'::jsonb,
    NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 96, now(), 'committed'
  );

  -- JP M14.46 - Electric Vehice Charging Station
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    jp_code, asset_qty, intervals_text, billing_basis,
    cycle_costs, year_totals, due_years,
    labour_hours_per_asset,
    notes,
    source_workbook, source_sheet, source_row, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Electric Vehice Charging Station', true,
    'M14.46', 2, 'A', 'fixed',
    '{"1YR": 250.0}'::jsonb, '{"2026": 500.0, "2027": 500.0, "2028": 500.0, "2029": 500.0, "2030": 500.0}'::jsonb, '{}'::jsonb,
    '{"A": 2.0}'::jsonb,
    NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Summary Cost Sheet', 98, now(), 'committed'
  );

  -- Additional items (RCD push, RCD battery, T&T)
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    asset_qty, billing_basis, unit_rate_per_asset,
    year_totals, intervals_text, notes,
    source_workbook, source_sheet, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'RCD Testing - 6 monthly push-button test', true,
    312, 'fixed', 8.5,
    '{"2026": 2652.0, "2027": 2652.0, "2028": 2652.0, "2029": 2652.0, "2030": 2652.0}'::jsonb, 'Semi-Annual', NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Additional Items', now(), 'committed'
  );
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    asset_qty, billing_basis, unit_rate_per_asset,
    year_totals, intervals_text, notes,
    source_workbook, source_sheet, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'RCD Testing - annual battery discharge test and push button test', true,
    312, 'fixed', 12.5,
    '{"2026": 3900.0, "2027": 3900.0, "2028": 3900.0, "2029": 3900.0, "2030": 3900.0}'::jsonb, 'Annual', NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Additional Items', now(), 'committed'
  );
  INSERT INTO public.contract_scopes (
    tenant_id, customer_id, site_id, financial_year, scope_item, is_included,
    asset_qty, billing_basis, unit_rate_per_asset,
    year_totals, intervals_text, notes,
    source_workbook, source_sheet, imported_at, status
  ) VALUES (
    v_tenant_id, v_customer_id, v_site_id, '2026', 'Test and Tag', true,
    0, 'fixed', 0,
    '{"2026": 0, "2027": 0, "2028": 0, "2029": 0, "2030": 0}'::jsonb, 'Per Unit', NULL,
    'DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov''2025.xlsx', 'Additional Items', now(), 'committed'
  );

  -- pm_calendar entries removed 2026-05-19 (Royce decision — calendar entries
  -- get recreated via /calendar UI per visit, not seeded).

  -- ---- Audit flags on 2026 contract scopes (resolved 2026-04-27) ----
  -- E1.25 ACB at SY3 has 0.25 hrs/yr/asset of labour but $0 in the SCS
  -- Annually column — flag for the audit-hit register, drives next-year
  -- repricing conversation with Equinix.
  UPDATE public.contract_scopes
     SET commercial_gap = true
   WHERE customer_id = v_customer_id AND site_id = v_site_id
     AND financial_year = '2026' AND jp_code = 'E1.25';

  -- T&T at SY3 is delivered (40 hrs on calendar) but priced $0 here — the
  -- cost is bundled inside one of the JP fixed prices.
  UPDATE public.contract_scopes
     SET has_bundled_scope = true
   WHERE customer_id = v_customer_id AND site_id = v_site_id
     AND financial_year = '2026' AND scope_item = 'Test and Tag';

END $$;

COMMIT;