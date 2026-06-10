-- Jemena: Generator Run-Start + Lighting Audit job plans (seed)
--
-- Source: 2026-04-27 Jemena report study + Royce confirmation:
--   Generator Run-Start: 6-monthly (one minor + one major; annual visit
--     has additional items beyond the 6-monthly checks).
--   Lighting Audit: assumed quarterly (not yet confirmed with Jemena —
--     revisit after first cycle).
--
-- Both plans are customer-scoped (Jemena NSW only). Idempotent via
-- WHERE NOT EXISTS guards. Apply after migration 0069 lands; safe to
-- re-run.

BEGIN;

-- ====== Plans ======

INSERT INTO job_plans (id, tenant_id, customer_id, site_id, name, code, type, description, frequency, is_active)
SELECT '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '556f999a-2023-50e3-ab07-a90056333cfe',
  NULL,
  'Jemena Generator Run-Start',
  'JEMENA-GEN-RUN-START',
  'Generator PPM',
  'Six-monthly generator run-start for Jemena NSW sites with backup generators (currently North Sydney + Greystanes only). Two visit types: a minor 6-monthly check and a major annual check. Major visit has additional items beyond the 6-monthly checks. Items use freq_semi_annual for every-visit checks and freq_annual for major-visit-only items.',
  'biannual',
  true
WHERE NOT EXISTS (SELECT 1 FROM job_plans WHERE id = '214ce8ca-df92-5657-ace3-3869dfcd1da0');

INSERT INTO job_plans (id, tenant_id, customer_id, site_id, name, code, type, description, frequency, is_active)
SELECT 'f67e5714-f1a5-50ad-a382-59e72e155be0',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '556f999a-2023-50e3-ab07-a90056333cfe',
  NULL,
  'Jemena Lighting Audit',
  'JEMENA-LIGHTING-AUDIT',
  'Lighting PPM',
  'Quarterly lighting audit for Jemena NSW sites (currently Old Guildford + Unanderra per SOW). Per-building walk-through with photographic evidence. Building items support up to 3 buildings — technician marks N/A on sites with fewer buildings. Frequency assumed quarterly; confirm with Jemena after first cycle.',
  'quarterly',
  true
WHERE NOT EXISTS (SELECT 1 FROM job_plans WHERE id = 'f67e5714-f1a5-50ad-a382-59e72e155be0');

-- ====== Generator Run-Start items ======
-- 6-monthly checks (run at every visit) → freq_semi_annual = true
-- Annual major-visit-only items → freq_annual = true

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT 'e832fabf-bc32-5a2c-91df-c3c88dedf521',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Visual check of Generator for damage. Photograph external condition. Note any damage in the comment field.',
  10, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = 'e832fabf-bc32-5a2c-91df-c3c88dedf521');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT '58f0c1cc-3284-5efb-8e7b-6eacc8b042bc',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Check coolant level. Record reading (full / low / topped up). Photograph reservoir.',
  20, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '58f0c1cc-3284-5efb-8e7b-6eacc8b042bc');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT '04b8379f-3bdb-5535-9033-efa152791661',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Check fuel level. Record reading. Photograph gauge / sight glass.',
  30, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '04b8379f-3bdb-5535-9033-efa152791661');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT '08728deb-ea36-527e-a4a7-50da25a21717',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Check starting batteries. Note last replacement date if known. Photograph terminals.',
  40, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '08728deb-ea36-527e-a4a7-50da25a21717');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT '5861a041-a38f-5f6e-80db-bebc459c3c10',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Check radiator hoses for cracks, leaks, swelling. Photograph any concerns.',
  50, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '5861a041-a38f-5f6e-80db-bebc459c3c10');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT '412dee86-36f2-54b4-962e-71cc706ed4c0',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Record generator hours from the controller display. Compare against previous reading.',
  60, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '412dee86-36f2-54b4-962e-71cc706ed4c0');

-- Annual major-visit item — under-load run.
INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_annual)
SELECT 'cda3e468-352e-5913-abd8-439318fd3434',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Run generator for 15 minutes under load. Verify protection devices operate correctly. Annual visit only — major check.',
  70, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = 'cda3e468-352e-5913-abd8-439318fd3434');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_semi_annual)
SELECT '49e03f6a-ff00-5593-8595-8dd9d0b8d4ef',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  '214ce8ca-df92-5657-ace3-3869dfcd1da0',
  'Confirm generator returned to standby mode at completion. Photograph standby indicator.',
  80, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '49e03f6a-ff00-5593-8595-8dd9d0b8d4ef');

-- ====== Lighting Audit items ======
-- All quarterly. Building 2 + 3 marked N/A by tech on smaller sites.

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_quarterly)
SELECT '6f15c424-764e-567d-9de9-f1ebf9767374',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'f67e5714-f1a5-50ad-a382-59e72e155be0',
  'Building 1 walk-through. Confirm all lights operational. Photograph each area. Record building name (e.g. Warehouse).',
  10, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '6f15c424-764e-567d-9de9-f1ebf9767374');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_quarterly)
SELECT '5db6de09-5dd2-50cd-a574-dbcdfd15e83d',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'f67e5714-f1a5-50ad-a382-59e72e155be0',
  'Building 2 walk-through. Confirm all lights operational. Photograph each area. N/A on single-building sites.',
  20, false, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '5db6de09-5dd2-50cd-a574-dbcdfd15e83d');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_quarterly)
SELECT '89a2c086-ffd9-55d9-8d25-8a7200878315',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'f67e5714-f1a5-50ad-a382-59e72e155be0',
  'Building 3 walk-through. Confirm all lights operational. Photograph each area. N/A on sites with fewer than 3 buildings.',
  30, false, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '89a2c086-ffd9-55d9-8d25-8a7200878315');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_quarterly)
SELECT '8d3de06b-e1f3-506c-a4d8-1b2647910e05',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'f67e5714-f1a5-50ad-a382-59e72e155be0',
  'Note any lighting defects (failed bulbs, damaged fittings, missing diffusers) for follow-up. Use the comments field per item; raise a separate defect record where remediation is needed.',
  40, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = '8d3de06b-e1f3-506c-a4d8-1b2647910e05');

INSERT INTO job_plan_items (id, tenant_id, job_plan_id, description, sort_order, is_required, freq_quarterly)
SELECT 'a70ec39d-e261-5129-9b45-a41c10bb792a',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'f67e5714-f1a5-50ad-a382-59e72e155be0',
  'Approved by SKS Technician — sign off captured via maintenance_checks.signature_technician_url + signature_initials (added migration 0068).',
  50, true, true
WHERE NOT EXISTS (SELECT 1 FROM job_plan_items WHERE id = 'a70ec39d-e261-5129-9b45-a41c10bb792a');

-- ====== Repoint generator assets to the new plan ======
-- The 2 FG Wilson generators were previously pinned to JEMENA-SWB-MAINT
-- (via the Phase 0 onboarding seed default). Repoint them to GEN-RUN-START
-- so the asset's "primary" job plan reflects the correct workflow.
-- DBs / MSBs continue pointing at SWB-MAINT.

UPDATE assets
SET job_plan_id = '214ce8ca-df92-5657-ace3-3869dfcd1da0'
WHERE id IN (
  '718915e7-60f0-5427-a410-615095494608',  -- Greystanes FG Wilson P220HE2
  '61dca134-b300-5a58-9936-811cbb998c91'   -- North Sydney FG Wilson (99 Walker St)
)
AND job_plan_id IS DISTINCT FROM '214ce8ca-df92-5657-ace3-3869dfcd1da0';

COMMIT;
