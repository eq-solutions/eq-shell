-- ============================================================
-- SY3 bootstrap verification queries
-- Run after seed-sy3.sql to confirm the data loaded correctly.
-- ============================================================

-- 1. Customer + site present?
SELECT c.name, c.contract_template, c.cpi_basis, c.cpi_rate, c.contract_term_start,
       c.smca_agreement_number, s.code AS site_code, s.address
  FROM public.customers c
  JOIN public.sites s ON s.customer_id = c.id
  JOIN public.tenants t ON t.id = c.tenant_id
 WHERE t.slug = 'sks'
   AND c.smca_agreement_number = '263389'
   AND s.code = 'SY3';
-- Expected: 1 row, contract_template='au_smca_v1', cpi_basis='simple_on_y1_base'

-- 2. Contract scopes total ties to contract PDF Y1 ($86,677.00)
SELECT
  COUNT(*) AS scope_rows,
  SUM((year_totals->>'2026')::numeric) AS total_y1_2026
  FROM public.contract_scopes cs
  JOIN public.sites s ON s.id = cs.site_id
 WHERE s.code = 'SY3' AND cs.financial_year = '2026';
-- Expected: scope_rows = 19 (16 JPs + 3 additional), total_y1_2026 = 86677.00

-- 3. CPI view returns escalated values matching the contract PDF Y2-Y5
SELECT yk AS year, SUM((yv)::numeric) AS total
  FROM public.contract_scopes_with_cpi cs
  JOIN public.sites s ON s.id = cs.site_id,
  LATERAL jsonb_each_text(cs.year_totals_with_cpi) AS yt(yk, yv)
 WHERE s.code = 'SY3' AND cs.financial_year = '2026'
  GROUP BY yk ORDER BY yk;
-- Expected:
--   2026 -> 86677.00
--   2027 -> 122510.85
--   2028 -> 212150.95
--   2029 -> 56841.05
--   2030 -> 71012.40

-- 4. PM calendar entries for 2026 SY3
SELECT category, COUNT(*) AS entries, SUM(hours) AS total_hours,
       SUM(contractor_materials_cost) AS total_cost
  FROM public.pm_calendar pc
  JOIN public.sites s ON s.id = pc.site_id
 WHERE s.code = 'SY3'
   AND pc.start_time >= '2026-01-01' AND pc.start_time < '2027-01-01'
   AND pc.draft_status = 'committed'
  GROUP BY category ORDER BY category;
-- Expected: ~9 categories (Quarterly x4, Emergency lighting x2, RCD testing x2, Lightning, Thermal, T&T, Dark site)

-- 5. Scope coverage gaps register for SY3 2026
SELECT g.jp_code, g.scope_description, g.expected_amount, g.severity, g.status, g.detection_reason
  FROM public.scope_coverage_gaps g
  JOIN public.sites s ON s.id = g.site_id
 WHERE s.code = 'SY3' AND g.contract_year = 2026 AND g.is_active = true
  ORDER BY g.expected_amount DESC;
-- Expected: 3 rows (severity auto-set by trigger from expected_amount)
--   E1.18 - $30,000 - high - 5YR MV Switchboard 8 of 9 due 2026
--   E1.9  - $14,000 - high - 5YR LV Switchboard 14 of 32 due 2026
--   E1.36 -    $500 - low  - 2YR Earthing System due 2026 (severity = low under hard-coded thresholds)

-- 7. Audit flags landed (resolved 2026-04-27)
SELECT jp_code, scope_item, has_bundled_scope, commercial_gap
  FROM public.contract_scopes cs
  JOIN public.sites s ON s.id = cs.site_id
 WHERE s.code = 'SY3' AND cs.financial_year = '2026'
   AND (commercial_gap = true OR has_bundled_scope = true)
 ORDER BY jp_code NULLS LAST;
-- Expected: 2 rows
--   E1.25 / Low Voltage Air Circuit Breaker (ACB) — commercial_gap = true
--   NULL  / Test and Tag                          — has_bundled_scope = true

-- 8. period_type / period_label on 2026 SY3 calendar
SELECT period_type, COUNT(*) AS entries
  FROM public.pm_calendar pc
  JOIN public.sites s ON s.id = pc.site_id
 WHERE s.code = 'SY3'
   AND pc.start_time >= '2026-01-01' AND pc.start_time < '2027-01-01'
   AND pc.is_active = true
 GROUP BY period_type ORDER BY period_type;
-- Expected:
--   quarter -> 4 (Q1/Q2/Q3/Q4 Maintenance)
--   custom  -> 8 (the dated WO-style entries)

-- 6. Cycle costs spot-check: E1.25 LV ACB 5YR
SELECT jp_code, asset_qty, cycle_costs, year_totals, due_years
  FROM public.contract_scopes cs
  JOIN public.sites s ON s.id = cs.site_id
 WHERE s.code = 'SY3' AND cs.jp_code = 'E1.25';
-- Expected: asset_qty=171, cycle_costs={"5YR":562.5}, year_totals={"2028":96187.5}, due_years={"2028":171}