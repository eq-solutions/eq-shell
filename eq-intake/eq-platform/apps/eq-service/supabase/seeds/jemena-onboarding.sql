-- Jemena NSW onboarding seed (Phase 0)
-- Generated from Master Asset Register. Idempotent via WHERE NOT EXISTS guards.
-- Apply via Supabase SQL editor or supabase db execute.

BEGIN;

-- ====== Customer ======
INSERT INTO customers (id, tenant_id, name, code, is_active)
SELECT '556f999a-2023-50e3-ab07-a90056333cfe', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'Jemena NSW', 'JEMENA-NSW', true
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE id = '556f999a-2023-50e3-ab07-a90056333cfe');

-- ====== Sites ======
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'North Sydney', '99 Walker St, North Sydney NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Greystanes', 'Greystanes NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = 'ec9bfc89-3488-5060-80d7-65018124ea5e');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '94c19afe-b12c-5ffb-a9f7-1ebb66ab1c46', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'North Rocks', 'North Rocks NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '94c19afe-b12c-5ffb-a9f7-1ebb66ab1c46');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '100b63eb-470f-5c64-a63f-3cf272d0d010', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Wetherill Park', '5 Ross Pl + 100-112/115-119 Cowpasture Rd, Wetherill Park NSW 2164', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '100b63eb-470f-5c64-a63f-3cf272d0d010');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '305a13f0-3117-5285-a67e-e73627f90886', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Riverwood', 'Riverwood NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '305a13f0-3117-5285-a67e-e73627f90886');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT 'c92f99d5-2b1e-5d54-a0f0-d3483058b3ee', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Old Guildford', 'Old Guildford NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = 'c92f99d5-2b1e-5d54-a0f0-d3483058b3ee');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT 'f2e69a7f-a86e-523f-bc11-167623322e2f', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Mittagong', 'Mittagong NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = 'f2e69a7f-a86e-523f-bc11-167623322e2f');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '03778bfd-d028-539d-ad2d-50548df4e585', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Unanderra', 'Unanderra NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '03778bfd-d028-539d-ad2d-50548df4e585');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '254779f9-22a0-5bc1-8e18-459034dd4ef8', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Tuggerah', 'Tuggerah NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '254779f9-22a0-5bc1-8e18-459034dd4ef8');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT 'c763a1bb-754e-53e9-83c2-6d97026a3be4', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Cardiff', 'Cardiff NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = 'c763a1bb-754e-53e9-83c2-6d97026a3be4');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT 'e1ebc65c-5825-514a-b27d-dd9ce2a0f324', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Goulburn Blackshaw Rd', 'Blackshaw Rd, Goulburn NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = 'e1ebc65c-5825-514a-b27d-dd9ce2a0f324');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT 'c1da126e-3631-50da-b0e3-7b8edcfb8523', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Goulburn Findlay Rd', 'Findlay Rd, Goulburn NSW (formerly Gulson St)', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = 'c1da126e-3631-50da-b0e3-7b8edcfb8523');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '3fcca550-cafa-5e50-b1c0-24258604c30e', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Young', 'Young NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '3fcca550-cafa-5e50-b1c0-24258604c30e');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '3b1c23a1-c126-5b5c-b8ef-afcb006edb03', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Griffith', 'Griffith NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '3b1c23a1-c126-5b5c-b8ef-afcb006edb03');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT '591c2252-6ad1-5b40-b7a5-15ee0490dfd8', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Dubbo', 'Dubbo NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = '591c2252-6ad1-5b40-b7a5-15ee0490dfd8');
INSERT INTO sites (id, tenant_id, customer_id, name, address, country, is_active)
SELECT 'eddeec6a-b0fe-522f-9a26-a3940ab62a26', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', 'Bathurst', 'Bathurst NSW', 'Australia', true
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = 'eddeec6a-b0fe-522f-9a26-a3940ab62a26');

-- ====== Job Plans (customer-scoped, applies to all Jemena sites) ======
-- Two plans split by activity type:
--  1. Switchboard Maintenance — annual visit (May). Technician marks N/A
--     on items not relevant to a given board (e.g. MSB on a site with no MSB).
--  2. RCD Testing — annual time-trip test (May) + 6-monthly push-button (May + Nov).

INSERT INTO job_plans (id, tenant_id, customer_id, site_id, name, code, type, description, frequency, is_active)
SELECT '6d3fb199-58c4-5a83-bfb6-c2545c195950', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', NULL,
  'Jemena Switchboard Maintenance', 'JEMENA-SWB-MAINT', 'Switchboard PPM',
  'Annual switchboard maintenance for Jemena NSW sites. Covers DBs, MSBs, and thermographic scanning. Technician marks items N/A where not applicable to a given board (e.g. MSB Maintenance is N/A on sites without an MSB).',
  'annual', true
WHERE NOT EXISTS (SELECT 1 FROM job_plans WHERE id = '6d3fb199-58c4-5a83-bfb6-c2545c195950');

INSERT INTO job_plans (id, tenant_id, customer_id, site_id, name, code, type, description, frequency, is_active)
SELECT 'e1ce18c3-bb94-5de9-9fe7-9a9aa40db8e5', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '556f999a-2023-50e3-ab07-a90056333cfe', NULL,
  'Jemena RCD Testing', 'JEMENA-RCD-TEST', 'RCD PPM',
  'Residual current device testing for Jemena NSW sites. Annual time-trip test (per AS/NZS 3760) at the May visit. Six-monthly push-button test at every visit (May + Nov).',
  'biannual', true
WHERE NOT EXISTS (SELECT 1 FROM job_plans WHERE id = 'e1ce18c3-bb94-5de9-9fe7-9a9aa40db8e5');

-- ====== Job Plan Items ======
INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_annual)
SELECT 'e216a3af-2ed8-5876-95e5-9d6fefcf2f02', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '6d3fb199-58c4-5a83-bfb6-c2545c195950',
  'Distribution Board Maintenance — inspect, clean, torque, verify isolation devices, photograph board open + closed. Repeat per DB on site.',
  10, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = 'e216a3af-2ed8-5876-95e5-9d6fefcf2f02');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_annual)
SELECT 'bb89e8ef-27a9-558a-a965-b6bf64ff2c2f', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '6d3fb199-58c4-5a83-bfb6-c2545c195950',
  'Main Switchboard (MSB) Maintenance — inspect, infrared scan, torque test on main connections, verify protection device settings + labelling. N/A where no MSB on site.',
  20, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = 'bb89e8ef-27a9-558a-a965-b6bf64ff2c2f');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_annual)
SELECT 'd85cc4de-0392-5770-b842-e1aefbf2cb8b', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '6d3fb199-58c4-5a83-bfb6-c2545c195950',
  'Thermographic Test (FLIR) — thermal scan of every board under load. Record any temperature anomaly >10°C above ambient or >5°C above adjacent phase. IS2 file per board.',
  30, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = 'd85cc4de-0392-5770-b842-e1aefbf2cb8b');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_annual)
SELECT '22d90884-e7fb-5bee-b62c-d65afc590891', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'e1ce18c3-bb94-5de9-9fe7-9a9aa40db8e5',
  'RCD Time Test — time-trip test each RCD on every board per AS/NZS 3760. Record trip time and pass/fail in the on-site test register. Annual visit (May).',
  10, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '22d90884-e7fb-5bee-b62c-d65afc590891');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT '2f90ac58-dfd7-5e6a-99a5-b49bd94b16bd', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'e1ce18c3-bb94-5de9-9fe7-9a9aa40db8e5',
  'RCD Push Button Test — manual button test on every RCD, verify trip operation. Quick check at every 6-monthly visit (May + Nov).',
  20, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '2f90ac58-dfd7-5e6a-99a5-b49bd94b16bd');

-- Soft-delete the obsolete first-pass plan (replaced by the two above).
UPDATE job_plans SET is_active = false
WHERE id = '7357eac5-d993-5835-9a27-6a3a58a280ea' AND is_active = true;

-- ====== Assets ======
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'c9a6caa7-639c-575d-a9bf-81323f0d9a6e', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'eddeec6a-b0fe-522f-9a26-a3940ab62a26', 'Unit 2 DB', 'Distribution Board', 'Hager', NULL, NULL, 'JM003470', 2, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'c9a6caa7-639c-575d-a9bf-81323f0d9a6e');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'fe6a983f-dce6-55dd-8e42-3793653578a4', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'eddeec6a-b0fe-522f-9a26-a3940ab62a26', 'Unit 3 DB', 'Distribution Board', 'Hager', NULL, NULL, 'JM003468', 7, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'fe6a983f-dce6-55dd-8e42-3793653578a4');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '81ba641c-e1f9-56ce-a111-fe27e08f6502', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c763a1bb-754e-53e9-83c2-6d97026a3be4', 'DB-1', 'Distribution Board', 'Schneider', 'IC60', 'Warehouse', 'JM003534', 58, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '81ba641c-e1f9-56ce-a111-fe27e08f6502');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'b4aaaca1-baf7-5768-9b96-0dda7e87faf1', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c763a1bb-754e-53e9-83c2-6d97026a3be4', 'DB-2', 'Distribution Board', 'Schneider', 'IC60', 'Warehouse', 'JM003585', 11, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'b4aaaca1-baf7-5768-9b96-0dda7e87faf1');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '0fde6b85-dd61-5340-a0f2-ea6b2ff0c621', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c763a1bb-754e-53e9-83c2-6d97026a3be4', 'Main DB', 'Distribution Board', 'Schneider', 'IC60', 'Hallway', 'JM003539', 4, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '0fde6b85-dd61-5340-a0f2-ea6b2ff0c621');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'd8275abf-3f78-5dfc-9c41-963365c19608', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c763a1bb-754e-53e9-83c2-6d97026a3be4', 'Main Switchboard', 'Main Switchboard', 'N/A', 'N/A', 'Left hand side of building', 'JM003518', NULL, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'd8275abf-3f78-5dfc-9c41-963365c19608');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '2bc609aa-c5af-5e3e-86c1-b830f1aa678b', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '591c2252-6ad1-5b40-b7a5-15ee0490dfd8', 'DB-Warehouse', 'Distribution Board', 'Clipsal', 'Resi Max', NULL, NULL, 15, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '2bc609aa-c5af-5e3e-86c1-b830f1aa678b');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'c847babc-33e2-5128-876f-d134600feeaf', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'e1ebc65c-5825-514a-b27d-dd9ce2a0f324', 'DB-1', 'Distribution Board', 'Hager', NULL, NULL, NULL, 6, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'c847babc-33e2-5128-876f-d134600feeaf');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'ed9edeb1-0363-58fa-8a0e-8bc4de55c6e6', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'e1ebc65c-5825-514a-b27d-dd9ce2a0f324', 'Main DB', 'Distribution Board', 'Hager', NULL, NULL, NULL, 1, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'ed9edeb1-0363-58fa-8a0e-8bc4de55c6e6');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'e80858d9-a446-5a09-92bc-dc209adb05ad', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c1da126e-3631-50da-b0e3-7b8edcfb8523', 'DB-1', 'Distribution Board', 'Schneider', 'IC60H', NULL, NULL, 16, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'e80858d9-a446-5a09-92bc-dc209adb05ad');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '2e32fb03-6763-5d51-abe3-c57afee76a0b', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'DB-LG', 'Distribution Board', 'NHP', 'DIN-T', 'Lower Ground Reception', 'JM003626', 23, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '2e32fb03-6763-5d51-abe3-c57afee76a0b');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '699624b9-5bb9-5daf-bed9-ea4fbf5aa475', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'DB-CP', 'Distribution Board', 'NHP', 'DIN-T', 'Main Switch Room', 'JM003620', 20, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '699624b9-5bb9-5daf-bed9-ea4fbf5aa475');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '272f4887-4926-50de-a3b5-ee953a32462d', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'DB-WH', 'Distribution Board', 'NHP', 'DIN-T', 'Warehouse', 'JM002011', 26, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '272f4887-4926-50de-a3b5-ee953a32462d');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '28da5207-e838-5d5c-9e08-3a33dfae6de6', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'DB-W', 'Distribution Board', 'NHP', 'DIN-T', 'Workshop', 'JM003638', 20, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '28da5207-e838-5d5c-9e08-3a33dfae6de6');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '571209da-6358-54e5-bc64-557dfb5ee14e', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'DB-L1', 'Distribution Board', 'NHP', 'DIN-T', 'Level 1 Office', 'JM002034', 55, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '571209da-6358-54e5-bc64-557dfb5ee14e');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'd8079d79-6ee5-59e5-923f-4bcc4002f687', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'DB-UPS', 'UPS Distribution Board', 'NHP', 'DIN-T', 'L1 UPS Room', 'JM002040', 10, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'd8079d79-6ee5-59e5-923f-4bcc4002f687');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'ff433be3-9372-5536-8817-c6fe1696972a', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'Main Switchboard', 'Main Switchboard', 'N/A', 'N/A', 'Main Switchroom', 'JM003622', NULL, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'ff433be3-9372-5536-8817-c6fe1696972a');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'be44f07c-69c7-508a-b10b-f97d669e558a', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '3b1c23a1-c126-5b5c-b8ef-afcb006edb03', 'DB-1', 'Distribution Board', 'N/A', 'N/A', 'Front Door behind cupboard', 'JM017191', NULL, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'be44f07c-69c7-508a-b10b-f97d669e558a');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'f02c269e-47d1-5723-bf89-43245c66cd1f', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'f2e69a7f-a86e-523f-bc11-167623322e2f', 'DB Unit 4B', 'Distribution Board', 'Hager', NULL, 'Front of Office', NULL, 12, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'f02c269e-47d1-5723-bf89-43245c66cd1f');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'f34fd95c-7032-5845-b101-7c7c76b0fd07', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '94c19afe-b12c-5ffb-a9f7-1ebb66ab1c46', 'Main DB Unit 4', 'Distribution Board', 'Hager', NULL, 'Warehouse', NULL, 4, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'f34fd95c-7032-5845-b101-7c7c76b0fd07');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'e3e1aea5-f875-5d0d-9b15-bf2ea701c68d', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-ESS-L9', 'ESS Distribution Board', 'NHP', 'DIN-T', NULL, 'JM030023', 15, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'e3e1aea5-f875-5d0d-9b15-bf2ea701c68d');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '0f7cde95-040e-55c7-ab5b-8df72b3c4f95', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-ESS-L10', 'ESS Distribution Board', 'NHP', 'DIN-T', NULL, 'JM029968', 3, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '0f7cde95-040e-55c7-ab5b-8df72b3c4f95');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '6a3db03f-8258-565b-b148-d7f081b3098c', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-Level 9', 'Distribution Board', 'NHP', 'DIN-T', NULL, 'JM029973', 24, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '6a3db03f-8258-565b-b148-d7f081b3098c');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'c8f112f5-01cd-5385-b83b-0ef454ccbf2b', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-Level 10', 'Distribution Board', 'NHP', 'DIN-T', NULL, 'JM029927', 41, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'c8f112f5-01cd-5385-b83b-0ef454ccbf2b');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'd8d1c649-128b-53e3-9a7f-c6eef349fe44', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-Level 11', 'Distribution Board', 'NHP', 'DIN-T', NULL, 'JM029886', 37, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'd8d1c649-128b-53e3-9a7f-c6eef349fe44');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '6538de75-cab0-50f2-b64f-f2ce20cb1fd8', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-Level 12', 'Distribution Board', 'NHP', 'DIN-T', NULL, 'JM029841', 44, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '6538de75-cab0-50f2-b64f-f2ce20cb1fd8');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '035ec53b-4098-590c-aed7-517a7b4eef92', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-UPS-A-L9', 'UPS Distribution Board', 'NHP', 'DIN-T', NULL, 'JM029998', 11, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '035ec53b-4098-590c-aed7-517a7b4eef92');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '0c254620-ecaa-58cb-bdc6-a1a2a9f409af', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'DB-UPS-B-L9', 'UPS Distribution Board', 'NHP', 'DIN-T', NULL, 'JM030010', 11, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '0c254620-ecaa-58cb-bdc6-a1a2a9f409af');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '116ef200-b329-5273-87ac-fa082c3c7e2f', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c92f99d5-2b1e-5d54-a0f0-d3483058b3ee', 'DB-L1', 'Distribution Board', 'Schneider', 'IC60', 'Utilities room', 'JM002121', 26, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '116ef200-b329-5273-87ac-fa082c3c7e2f');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '83d3f16a-fb87-5c79-b7ca-b62ef8efc904', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c92f99d5-2b1e-5d54-a0f0-d3483058b3ee', 'DB-GO', 'Distribution Board', 'Schneider', 'IC60', 'Warehouse', 'JM002102', 16, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '83d3f16a-fb87-5c79-b7ca-b62ef8efc904');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'f1fb56e1-1e91-5e62-95be-82f5ef888b43', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c92f99d5-2b1e-5d54-a0f0-d3483058b3ee', 'DB-GW', 'Distribution Board', 'Schneider', 'IC60', 'Warehouse', 'JM002103', 27, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'f1fb56e1-1e91-5e62-95be-82f5ef888b43');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '9d089c73-4f9d-59d7-a7a4-76398d107b09', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c92f99d5-2b1e-5d54-a0f0-d3483058b3ee', 'DB-Igloo', 'Distribution Board', 'Schneider', 'IC60', 'Warehouse', 'JM030422', 2, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '9d089c73-4f9d-59d7-a7a4-76398d107b09');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '79386abf-eb5f-58f8-ae6d-835493a89cc9', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'c92f99d5-2b1e-5d54-a0f0-d3483058b3ee', 'Main Switchboard', 'Main Switchboard', 'N/A', 'N/A', 'Carpark Front Of Warehouse', 'JM002072', NULL, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '79386abf-eb5f-58f8-ae6d-835493a89cc9');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '42335ae0-2c42-5216-968b-7f924daed434', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '305a13f0-3117-5285-a67e-e73627f90886', 'DB-1', 'Distribution Board', 'NHP', 'DIN-T', 'Warehouse', 'JM002153', 13, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '42335ae0-2c42-5216-968b-7f924daed434');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'c590cd18-54cc-5bc6-ac04-72647535fb21', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '305a13f0-3117-5285-a67e-e73627f90886', 'Main Switchboard', 'Main Switchboard', NULL, NULL, NULL, 'JM002160', NULL, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'c590cd18-54cc-5bc6-ac04-72647535fb21');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '60c6c907-3c27-54ed-bbc7-df0a44583151', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '254779f9-22a0-5bc1-8e18-459034dd4ef8', 'DB-1', 'Distribution Board', 'Hager', NULL, 'Warehouse', 'JM003488', 2, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '60c6c907-3c27-54ed-bbc7-df0a44583151');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '1bfcb657-2dad-5126-a937-7855fc316b45', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '03778bfd-d028-539d-ad2d-50548df4e585', 'Unit 1', 'Distribution Board', 'Clipsal', 'Resi MAX', NULL, NULL, 12, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '1bfcb657-2dad-5126-a937-7855fc316b45');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '191cd2b5-2987-5b2e-ac02-ab633412cefc', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '03778bfd-d028-539d-ad2d-50548df4e585', 'Unit 2', 'Distribution Board', 'Clipsal', 'Resi MAX', NULL, NULL, 7, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '191cd2b5-2987-5b2e-ac02-ab633412cefc');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '3bf7b3cf-fa32-5087-9abd-28537206841d', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '100b63eb-470f-5c64-a63f-3cf272d0d010', 'DB1', 'Distribution Board', 'Butler and Reardon', NULL, 'Front gate / Main entry gate', NULL, 3, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '3bf7b3cf-fa32-5087-9abd-28537206841d');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '63c5056e-eff7-50b7-b541-065f833e3761', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '100b63eb-470f-5c64-a63f-3cf272d0d010', 'DB2', 'Distribution Board', 'Generic (no branding)', NULL, 'Back side of demountable', NULL, 2, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '63c5056e-eff7-50b7-b541-065f833e3761');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '6f1e86e9-893e-55c9-b776-1e8ee1dd2ae7', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '100b63eb-470f-5c64-a63f-3cf272d0d010', 'DB2a', 'Distribution Board', 'Unknown', NULL, 'Demountable office by DB2', NULL, 4, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '6f1e86e9-893e-55c9-b776-1e8ee1dd2ae7');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '72b62866-2602-5b20-9872-348e5c441fb0', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '100b63eb-470f-5c64-a63f-3cf272d0d010', 'DB3', 'Distribution Board', 'Echo', NULL, 'Outside exit gate', NULL, 3, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '72b62866-2602-5b20-9872-348e5c441fb0');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT 'eff789ec-36d5-5608-b22a-dfe7d147f0eb', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '100b63eb-470f-5c64-a63f-3cf272d0d010', 'Security Office', 'Distribution Board', 'Unknown', NULL, 'Inside Security Office', NULL, 6, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = 'eff789ec-36d5-5608-b22a-dfe7d147f0eb');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '840838c3-87ae-5016-a076-280447b84876', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '3fcca550-cafa-5e50-b1c0-24258604c30e', 'DB-1', 'Distribution Board', 'Unknown', NULL, NULL, 'JM003461', 2, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '840838c3-87ae-5016-a076-280447b84876');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '698bb287-a381-5c60-8bd2-0f38d3d9946d', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '3fcca550-cafa-5e50-b1c0-24258604c30e', 'DB-2', 'Distribution Board', 'Hager', NULL, NULL, 'JM003462', 10, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '698bb287-a381-5c60-8bd2-0f38d3d9946d');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '718915e7-60f0-5427-a410-615095494608', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'ec9bfc89-3488-5060-80d7-65018124ea5e', 'FG Wilson P220HE2', 'Generator', 'FG Wilson', 'P220HE2', 'Generator yard', NULL, NULL, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '718915e7-60f0-5427-a410-615095494608');
INSERT INTO assets (id, tenant_id, site_id, name, asset_type, manufacturer, model, location, jemena_asset_id, expected_rcd_circuits, job_plan_id, is_active)
SELECT '61dca134-b300-5a58-9936-811cbb998c91', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', '9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'FG Wilson P220HE2 (99 Walker St)', 'Generator', 'FG Wilson', 'P220HE2', '99 Walker St', NULL, NULL, '6d3fb199-58c4-5a83-bfb6-c2545c195950', true
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE id = '61dca134-b300-5a58-9936-811cbb998c91');

-- ====== Calendar (May 2026 PPM) ======
-- Calendar INSERTs removed 2026-05-19 (Royce decision — calendar entries
-- get recreated via /calendar UI per visit, not seeded).

-- ====== Backfill site code/city/state/postcode (data-quality audit fix) ======
-- The Sites sheet of the Master Asset Register doesn't break the address into
-- city/state/postcode columns, so the initial INSERTs leave those null. The
-- data-quality audit (audits/run.sql) treats null code/city/state/postcode as
-- ERROR-level. This UPDATE backfills with well-known NSW postcodes and unique
-- JEM-prefixed site codes. Idempotent — only fires on rows still missing data.
UPDATE sites SET
  code = v.code,
  city = v.city,
  state = v.state,
  postcode = v.postcode
FROM (VALUES
  ('9fcbe8a4-d3b9-5f7c-9dee-0f2549c50039', 'JEM-NSY', 'North Sydney', 'NSW', '2060'),
  ('ec9bfc89-3488-5060-80d7-65018124ea5e', 'JEM-GRE', 'Greystanes', 'NSW', '2145'),
  ('94c19afe-b12c-5ffb-a9f7-1ebb66ab1c46', 'JEM-NRO', 'North Rocks', 'NSW', '2151'),
  ('100b63eb-470f-5c64-a63f-3cf272d0d010', 'JEM-WET', 'Wetherill Park', 'NSW', '2164'),
  ('305a13f0-3117-5285-a67e-e73627f90886', 'JEM-RIV', 'Riverwood', 'NSW', '2210'),
  ('c92f99d5-2b1e-5d54-a0f0-d3483058b3ee', 'JEM-OGU', 'Old Guildford', 'NSW', '2161'),
  ('f2e69a7f-a86e-523f-bc11-167623322e2f', 'JEM-MIT', 'Mittagong', 'NSW', '2575'),
  ('03778bfd-d028-539d-ad2d-50548df4e585', 'JEM-UNA', 'Unanderra', 'NSW', '2526'),
  ('254779f9-22a0-5bc1-8e18-459034dd4ef8', 'JEM-TUG', 'Tuggerah', 'NSW', '2259'),
  ('c763a1bb-754e-53e9-83c2-6d97026a3be4', 'JEM-CAR', 'Cardiff', 'NSW', '2285'),
  ('e1ebc65c-5825-514a-b27d-dd9ce2a0f324', 'JEM-GBL', 'Goulburn', 'NSW', '2580'),
  ('c1da126e-3631-50da-b0e3-7b8edcfb8523', 'JEM-GFI', 'Goulburn', 'NSW', '2580'),
  ('3fcca550-cafa-5e50-b1c0-24258604c30e', 'JEM-YOU', 'Young', 'NSW', '2594'),
  ('3b1c23a1-c126-5b5c-b8ef-afcb006edb03', 'JEM-GRI', 'Griffith', 'NSW', '2680'),
  ('591c2252-6ad1-5b40-b7a5-15ee0490dfd8', 'JEM-DUB', 'Dubbo', 'NSW', '2830'),
  ('eddeec6a-b0fe-522f-9a26-a3940ab62a26', 'JEM-BAT', 'Bathurst', 'NSW', '2795')
) AS v(id, code, city, state, postcode)
WHERE sites.id = v.id::uuid
  AND (sites.code IS NULL OR sites.city IS NULL OR sites.state IS NULL OR sites.postcode IS NULL);

COMMIT;
