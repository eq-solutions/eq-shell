# Equinix Maximo PDF Work Orders — 2026-05-19

Real customer fixture captured 2026-05-19 from an email forwarded by Danny O'Toole (Equinix Australia Operations) to Royce Milmlow at SKS Technologies.

Email subject: `Fw: [EXTERNAL] Re: [EXTERNAL] Re: 2026 Dates for maintenance`

## What's in this bundle

Seven Maximo work orders across 4 PDFs, all for site **AU01-CA1** (Canberra 1).

| WO# | Asset | Job Plan | Target Date | Source PDF |
|---|---|---|---|---|
| 4398474 | 1070 — CA1-TS-AC-29-ATS | ATS-3 / E1.8 | 20-May-2026 | 20260519090849405.pdf |
| 4406648 | 1135 — CA1-MECH-POP-A | ATS-3 / E1.8 | 20-May-2026 | 20260519090849405.pdf |
| 4406759 | 1137 — CA1-MECH-POP-B | ATS-3 / E1.8 | 20-May-2026 | 20260519090925883.pdf |
| 4408095 | 1158 — CA1-SMDB-1-1A-GLP (ATS) | ATS-3 / E1.8 | 20-May-2026 | 20260519090925883.pdf |
| 4408213 | 1159 — CA1-LVSB-1-1A-DHATS-1-1B (ATS) | ATS-3 / E1.8 | 20-May-2026 | 20260519091018936.pdf |
| 4409209 | 1170 — CA1-SMDB-1-2A-GLP (ATS) | ATS-3 / E1.8 | 20-May-2026 | 20260519091018936.pdf |
| 4501310 | CA1-PTP — CA1-Comprehensive Utility Failure Test | PTP-A / E1.33 | 20-Jun-2026 | CUFT Work Order.pdf |

The three numerically-named files are scans from Equinix's office scanner (each one carries 2 stapled WO printouts). `CUFT Work Order.pdf` is a fresh PDF print from Maximo (cleaner, no scan artefacts).

## Canonical shape — fields a `maximo-pdf-wo` skill should extract

Every Maximo WO PDF carries the same header table at the top of page 1. Field names match what's printed on the page:

- **Site** — e.g. `AU01-CA1` (eq-service strips the `AU0x-` prefix per `stripSitePrefix()` in `lib/import/delta-wo-parser.ts`)
- **Asset** — both a numeric Maximo ID and a descriptive name, e.g. `1070 — CA1-TS-AC-29-ATS` or `CA1-PTP - CA1-Comprehensive Utility Failure Test (PTP)`. The CUFT format omits the leading numeric ID.
- **Serial #** — sometimes populated, sometimes `N/A`. Capture as nullable string.
- **Status** — e.g. `INPRG`. Maximo status code.
- **Location** — e.g. `CA1-GF-22 - CA1-GF-Node Room`. Sub-location within site.
- **Work Type** — e.g. `PM`
- **Priority** — integer 1-4
- **Job Plan** — e.g. `ATS-3 - E1.8 ATS-Automatic Transfer Switches` (the canonical eq-service identifier is the bit after the dash: `E1.8`)
- **CrewID** — usually blank on these PDFs
- **Target Start** / **Target Finish** — e.g. `20-May-2026` / `20-May-2026`
- **Actual Start** / **Actual Finish** — blank until completed
- **Classification** — e.g. `ATS-Auto Transfer Switch`, `BLDFAB-Building Fabric`
- **Failure** / **Problem** / **Cause** / **Remedy** — Maximo failure-code chain, blank when scheduling
- **IR Scan p/f** — blank when scheduling, populated by the tech after the visit
- **WO#** (header row, top-left of the table area) — e.g. `4398474`. Top-level identifier.

Below the header is a numbered tasks table (1, 2, 10, 20, …) with descriptions, plus two empty boolean columns (`Complete`, `N/A`) for the tech to tick. These are the same task descriptions that exist as `job_plan_items` rows in eq-service — the PDF carries them inline for the field-printed version. The skill probably doesn't need to extract tasks; it should reference the job_plan_id and let eq-service hydrate items from there.

Footer: `IBM Maximo` + Equinix logo on every page. `rev 3.1` template version stamp on the bottom-right.

## Mapping to eq-service maintenance_check creation

One PDF (one WO) maps to one row in `check_assets`. WOs that share `(site, target_start, job_plan)` collapse into a single `maintenance_checks` row — this is exactly what the consolidate-multiple-files toggle in PR #5 was built for, just driven by PDF parses instead of xlsx parses.

For this bundle:
- **6 ATS WOs** (all site AU01-CA1, target 20-May-2026, plan ATS-3 E1.8) → 1 maintenance check with 6 check_assets
- **1 CUFT WO** (site AU01-CA1, target 20-Jun-2026, plan PTP-A E1.33) → 1 maintenance check with 1 check_asset

## Why this fixture matters

This is the proving ground for the Intake-as-Service pattern (see `~/.claude/projects/C--Projects-eq-solves-service/memory/project_intake_as_service_pattern.md`). When the `maximo-pdf-wo` skill is built in EQ Intake, this bundle is the regression bait:

- The 3 scanned PDFs exercise OCR pathways (image-based input, varies in scan quality)
- The CUFT PDF exercises the clean-print pathway (text-extractable, no OCR needed)
- Multi-WO-per-PDF is real (each scanned PDF has 2 stapled WOs)
- Multi-PDF-one-visit consolidates correctly (6 WOs → 1 check)
- Job plan code variant: `ATS-3` (no frequency suffix in printed name) but the eq-service plan code is `E1.8` — the skill needs to map sensibly
- Mixed ATS and CUFT in one email proves the skill handles the same shape across different Maximo plan types
- Site prefix `AU01-CA1` follows the same convention as the existing Delta xlsx flow (`AU0x-` strip)

The skill should round-trip: PDF → canonical work_order rows → eq-service maintenance_check + check_assets identical to what the existing Delta xlsx importer produces from the same WOs in spreadsheet form.

## Status as of 2026-05-21

- **Skill implemented in EQ Intake** — `eq-platform/packages/eq-intake/src/skills/maximo-pdf-wo/`. Public entry `parseMaximoPdfWo({ files, ai? })`. Returns `MaintenanceCheckBundle[]` of canonical insert candidates (one bundle per grouped check).
- Fixture-driven tests live at `eq-platform/packages/eq-intake/test/skills/maximo-pdf-wo.test.ts`. They feed the 4 PDFs in this directory through a mock `AIProvider` (canned `work_orders[]` matching the table above) and assert: 2 maintenance_checks + 7 check_assets, correct grouping, idempotent re-parse, iteration-order-independent output.
- No new canonical schema was needed — `maintenance_check` + `check_asset` already cover the shape. The schema in `eq-intake/src/skills/maximo-pdf-wo/schema.ts` is the AI prompt's extraction schema only (wraps WO records in `{ work_orders: [...] }` for multi-WO PDFs).
- Real-world routing: every PDF in this fixture is CCITTFax-encoded — `unpdf` returns zero extractable text, so all 4 hit the vision path. The skill still tries text first and would skip the AI call if Maximo ever ships a born-digital print.
- eq-service integration is the next session's work: wire `parseMaximoPdfWo` behind the existing `/maintenance/new` PDF-upload affordance, run the returned bundles through `validate()` + `commitDeltaImportAction` (or its successor) and retire the manual-entry flow for these PDFs.
