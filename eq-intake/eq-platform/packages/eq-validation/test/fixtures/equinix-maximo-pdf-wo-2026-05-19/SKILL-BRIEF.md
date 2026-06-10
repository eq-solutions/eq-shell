# Skill brief — `maximo-pdf-wo`

Stub brief for the future EQ Intake skill that ingests IBM Maximo work-order PDFs (Equinix's preferred handoff for ad-hoc / mid-cycle WO additions).

**Status:** Implemented 2026-05-21 — see `eq-platform/packages/eq-intake/src/skills/maximo-pdf-wo/` and the fixture-driven test at `eq-platform/packages/eq-intake/test/skills/maximo-pdf-wo.test.ts`. The skill emits `MaintenanceCheckBundle[]` (canonical insert candidates); the integration into eq-service is the next session's work.

## Goal

Given a single Maximo WO PDF (or multi-WO scan), produce canonical rows shaped against the existing schemas:

- `maintenance_check.schema.json` (one per `(site, target_start, plan)` tuple)
- `check_asset.schema.json` (one per WO — carries `priority`, `work_type`, `target_start`, `target_finish`, `failure_code`, `problem`, `cause`, `remedy`, `classification`, `ir_scan_result`, `work_order_number` per the existing schema)

**No new canonical schemas required.** The shape is fully covered by what already exists in `C:/Projects/eq-intake/schemas/`.

## Input shapes seen in this fixture

1. **Clean-print PDF** (`CUFT Work Order.pdf`) — fresh print from Maximo, text-extractable, no OCR needed. 1 WO per PDF.
2. **Scanned PDF** (the three numerically-named files) — Equinix scans paper printouts into multi-page PDFs. 2 stapled WOs per scan. Requires OCR.

The skill should sniff input type (text-extractable vs. image-based) and route accordingly. `@eq/ai`'s vision extraction handles the scanned path; pdf-parse or equivalent handles the clean-print path.

## Fields to extract (top header table on every Maximo WO PDF)

| PDF label | Canonical target | Notes |
|---|---|---|
| WO# (top of header table) | `check_asset.work_order_number` | 7-digit numeric, e.g. `4501310` |
| Site | `maintenance_check.site_id` (FK fuzzy on site.code/name) | Strip `AU0x-` prefix to match eq-service sites.code (see `lib/import/delta-wo-parser.ts::stripSitePrefix`) |
| Asset | `check_asset.asset_id` (FK fuzzy on asset.external_id/name) | Format varies: `1070 — CA1-TS-AC-29-ATS` (numeric ID + descriptive) or `CA1-PTP - …` (no numeric ID). Match against `asset.external_id` first (the numeric Maximo ID), fall back to fuzzy on name. |
| Serial # | (not in canonical check_asset — drop or note) | Often `N/A`. Out of scope for canonical mapping. |
| Status | `maintenance_check.status` | Maximo codes (`INPRG` → `in_progress`, `WAPPROV` → `scheduled`, `COMP` → `complete`) — `x-eq-enum-aliases` already covers these. |
| Location | (no canonical home — drop or stash in notes) | Sub-location within site, e.g. `CA1-GF-22 - CA1-GF-Node Room`. |
| Work Type | `check_asset.work_type` | `PM`/`CM`/`EM`/`CAL`/`INSP`. |
| Priority | `check_asset.priority` | Integer 1-4 → `urgent`/`high`/`medium`/`low` via existing enum aliases. |
| Job Plan | `maintenance_check.plan_id` (FK fuzzy on plan.code/name) | Format: `ATS-3 - E1.8 ATS-Automatic Transfer Switches`. Match the bit after the dash (`E1.8`) which is what eq-service uses as the plan code. |
| CrewID | `check_asset.crew_id` | Usually blank on these PDFs. |
| Target Start / Target Finish | `check_asset.target_start` / `target_finish` | Format `20-May-2026`. ISO-coerce. |
| Actual Start / Actual Finish | `check_asset.completed_at` (if Actual Finish present) | Blank on scheduling, populated post-completion. |
| Classification | `check_asset.classification` | e.g. `ATS-Auto Transfer Switch`, `BLDFAB-Building Fabric`. |
| Failure / Problem / Cause / Remedy | `check_asset.failure_code`, `.problem`, `.cause`, `.remedy` | Blank when scheduling. |
| IR Scan p/f | `check_asset.ir_scan_result` | Blank when scheduling. |

The tasks table (numbered 1, 2, 10, 20, …) is the printed copy of the underlying `job_plan_items` rows. The skill should NOT extract tasks individually — eq-service hydrates them from `plan_id`.

## Grouping rule for `maintenance_check`

Multiple WOs in this bundle collapse into fewer maintenance_checks. Apply the same rule used by the Delta xlsx importer (`lib/import/delta-wo-parser.ts::groupKey`):

```
group_key = (siteCode, planCode, frequency, target_start_date)
```

For this fixture:
- 6 ATS WOs at `AU01-CA1` for `ATS-3 E1.8` on `2026-05-20` → 1 maintenance_check with 6 check_assets
- 1 CUFT WO at `AU01-CA1` for `PTP-A E1.33` on `2026-06-20` → 1 maintenance_check with 1 check_asset

## Cross-check against existing eq-service Delta importer

The skill output should round-trip 1:1 with the existing `commitDeltaImportAction` output when given the same WOs in xlsx form. The existing parser is in `lib/import/delta-wo-parser.ts` and the row → check_asset shape is in `lib/import/delta-row-mapping.ts::deltaRowToCheckAssetInsert`. Both belong to eq-service and will be retired (per [project_eq_service_canonical_migration]) once this skill ships.

## Test expectations

- Parse the CUFT PDF (clean text path) → emit 1 maintenance_check + 1 check_asset, fields populated per the table above.
- Parse each scanned PDF (OCR path) → emit 2 check_assets per file with correct WO# per asset.
- Consolidate all 4 PDFs → 2 maintenance_checks (one for 20-May ATS, one for 20-Jun CUFT) covering 7 check_assets total.
- Idempotent re-parse on the same fixture set produces zero diffs.
