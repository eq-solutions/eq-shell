-- ============================================================
-- Demo tenant enrichment seed
--
-- Decision captured during overnight battle-test 2026-04-30:
--   "Fix canonical PPM check + seed RCD demo — single demo tenant"
--
-- Closes Issues #8 (no rcd_tests in demo) + #18 (canonical PPM
-- check 10000000-...001 had zero linked check_assets despite the
-- site having 7 assets).
--
-- Idempotent: every INSERT uses ON CONFLICT DO NOTHING.
-- Safe to re-run on the demo tenant only — guarded by explicit
-- tenant_id = a0000000-0000-0000-0000-000000000001 throughout.
-- ============================================================

BEGIN;

-- ── 1. PPM canonical check — link 4 ACBs as check_assets + tasks ────────

-- All four Harborview ACBs (SYD-ACB-01..04) become check_assets for the
-- existing E1.25 PPM check 10000000-...001 at Harborview.
INSERT INTO public.check_assets (id, tenant_id, check_id, asset_id, status, work_order_number, created_at, updated_at, completed_at)
VALUES
  ('11000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'complete', 'WO-SYD-2026-001', now(), now(), now()),
  ('11000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'complete', 'WO-SYD-2026-002', now(), now(), now()),
  ('11000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'complete', 'WO-SYD-2026-003', now(), now(), now()),
  ('11000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000004', 'complete', 'WO-SYD-2026-004', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

-- Per-asset task rows. E1.25 has no job_plan_items defined in demo, so we
-- inline a representative 5-task ACB inspection set. All marked complete
-- since the parent check itself is in 'complete' state.
INSERT INTO public.maintenance_check_items (
  id, tenant_id, check_id, check_asset_id, asset_id, description, sort_order, is_required, result, completed_at, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'a0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  ca.id,
  ca.asset_id,
  task.description,
  task.sort_order,
  true,
  'pass',
  now(),
  now(),
  now()
FROM (
  VALUES
    (1, 'Visual inspection — general condition, cleanliness, no signs of arcing'),
    (2, 'Mechanical operation — manual close/open cycle, racking mechanism'),
    (3, 'Contact resistance (R/W/B phase, µΩ)'),
    (4, 'Insulation resistance — closed and open positions'),
    (5, 'Auxiliary contacts + trip unit operation check')
) AS task(sort_order, description)
CROSS JOIN public.check_assets ca
WHERE ca.check_id = '10000000-0000-0000-0000-000000000001'
  AND ca.tenant_id = 'a0000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;

-- ── 2. RCD demo — board asset + RCD check + rcd_test + 10 circuits ─────

-- 2a. Add a Distribution Board asset at Harborview (slot 005 was unused).
-- assets table has no customer_id (derived via sites.customer_id) and no code column.
INSERT INTO public.assets (
  id, tenant_id, site_id, name, asset_type, maximo_id,
  expected_rcd_circuits, is_active, created_at, updated_at
)
VALUES (
  'f0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  'PIN-SYD-DB1',
  'Distribution Board',
  'DB-SYD-001',
  10,
  true,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- 2b. An RCD-kind maintenance_check for that site (annual frequency,
-- complete status to mirror the demo's other "completed visit" feel).
-- Uses job_plan_id = NULL since demo has no RCD job plan; that matches
-- the Jemena pattern for RCD-overlay checks.
INSERT INTO public.maintenance_checks (
  id, tenant_id, site_id, job_plan_id, kind, frequency, status,
  due_date, custom_name, created_at, updated_at, completed_at
)
VALUES (
  '12000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  NULL,
  'rcd',
  'annual',
  'complete',
  '2026-03-15',
  'Annual RCD Time-Trip — Harborview',
  now(),
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- 2c. rcd_tests row — one board, one test header per visit.
INSERT INTO public.rcd_tests (
  id, tenant_id, customer_id, site_id, asset_id, check_id,
  test_date, technician_name_snapshot, technician_initials,
  site_rep_name, equipment_used, status, is_active, created_at, updated_at
)
VALUES (
  '13000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000005',
  '12000000-0000-0000-0000-000000000001',
  '2026-03-15',
  'Demo Technician',
  'DT',
  'Site Manager',
  'Megger RCDT320',
  'complete',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- 2d. Ten circuits — mix of normal + critical-load + a couple of failures
-- to make the RCD detail page feel like real compliance evidence. Trip
-- times in ms (real RCDs trip well under 300ms at X1; under 40ms at X5).
INSERT INTO public.rcd_test_circuits (
  id, tenant_id, rcd_test_id, section_label, circuit_no, normal_trip_current_ma,
  x1_no_trip_0_ms, x1_no_trip_180_ms, x1_trip_0_ms, x1_trip_180_ms,
  x5_fast_0_ms, x5_fast_180_ms, trip_test_button_ok, is_critical_load,
  action_taken, sort_order, created_at, updated_at
)
VALUES
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'A',  '1',  30, '>2000', '>2000', '187', '194', '24', '26', true, false, NULL, 1, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'A',  '2',  30, '>2000', '>2000', '203', '211', '28', '29', true, false, NULL, 2, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'A',  '3',  30, '>2000', '>2000', '195', '188', '25', '27', true, true,  'UPS feeder — critical load, tested with override', 3, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'A',  '4',  30, '>2000', '>2000', '212', '218', '31', '30', true, false, NULL, 4, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'B',  '5',  30, '>2000', '>2000', '198', '201', '26', '28', true, false, NULL, 5, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'B',  '6',  30, '>2000', '>2000', '189', '193', '24', '25', true, true,  'ESS feeder — critical load', 6, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'B',  '7',  30, '>2000', '>2000', '341', '358', '52', '49', false, false, 'Failed X1 trip + button — replaced unit 2026-03-15', 7, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'B',  '8',  30, '>2000', '>2000', '205', '209', '27', '28', true, false, NULL, 8, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'C',  '9',  30, '>2000', '>2000', '193', '200', '26', '27', true, false, NULL, 9, now(), now()),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'C',  '10', 30, '>2000', '>2000', '184', '190', '23', '24', true, false, NULL, 10, now(), now())
ON CONFLICT DO NOTHING;

COMMIT;

-- ── 3. Verify ─────────────────────────────────────────────────────────────
-- (run separately to confirm the seed worked)
-- select 'check_assets' kind, count(*) from check_assets where check_id = '10000000-0000-0000-0000-000000000001'
-- union all select 'check_items', count(*) from maintenance_check_items where check_id = '10000000-0000-0000-0000-000000000001'
-- union all select 'rcd_check', count(*) from maintenance_checks where id = '12000000-0000-0000-0000-000000000001'
-- union all select 'rcd_test', count(*) from rcd_tests where id = '13000000-0000-0000-0000-000000000001'
-- union all select 'rcd_circuits', count(*) from rcd_test_circuits where rcd_test_id = '13000000-0000-0000-0000-000000000001';
