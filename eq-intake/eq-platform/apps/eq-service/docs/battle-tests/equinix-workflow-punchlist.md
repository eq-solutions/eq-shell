# Equinix workflow punchlist — 2026-05-21

Battle-test audit of the Equinix monthly workflow end-to-end (xlsx import → check completion → Customer Report → send), produced autonomously after Royce green-lit the run.

**Scope:** code-level audit only. UI testing (clicking through the live wizard, eyes-on visual review of generated docx) deferred until Royce is at the keyboard.

**Smoke tests:** all green. `pm-asset-report`, `pm-asset-report-with-tests`, `maintenance-checklist` → 3 files, 7 tests, all pass. Baseline solid.

## Severity legend

- 🔴 **Blocking** — breaks the workflow or produces misleading output to the customer
- 🟠 **High** — degrades the experience or wastes data we already capture
- 🟡 **Medium** — clunky / inconsistent but doesn't break correctness
- 🟢 **Polish** — cosmetic or future-proofing

---

## 🔴 Blocking

### 1. The Customer Report doesn't render the Maximo metadata that PR #178 was added to persist

**Where:** [app/api/pm-asset-report/route.ts:414-445](app/api/pm-asset-report/route.ts) (the `assetSections` builder)

**What's happening:** PR #178 added 11 columns to `check_assets` (`priority`, `work_type`, `crew_id`, `target_start`, `target_finish`, `failure_code`, `problem`, `cause`, `remedy`, `classification`, `ir_scan_result`) and the Delta importer faithfully populates them via `deltaRowToCheckAssetInsert` ([lib/import/delta-row-mapping.ts:86-108](lib/import/delta-row-mapping.ts:86)). But the Customer Report at `/api/pm-asset-report` only reads `work_order_number` — the other 10 fields don't appear anywhere on the customer PDF.

So Equinix gets a Customer Report that's missing exactly the Maximo-level details (priority, work type, failure codes, IR scan results) that make it valuable as compliance evidence. The data is in the database; it just doesn't flow to the page.

**Note:** The data IS consumed by `generateWorkOrderDetailsReport` ([lib/reports/work-order-details.ts:63-98](lib/reports/work-order-details.ts:63) + [lib/reports/generate-and-store.ts:380-403](lib/reports/generate-and-store.ts:380)). That's a separate report type (`wo_details`) generated from the `/(app)/reports` page, not the Customer Report you click from `/maintenance/[id]`. The two reports are inconsistent — one shows the data, the other doesn't.

**Proposed fix:** Extend `PmAssetSection` in [lib/reports/pm-asset-report.ts](lib/reports/pm-asset-report.ts) to carry the same Maximo fields, and surface them in each per-asset section of the Customer Report. Cheapest version: a single "Work order details" sub-block per asset with the labelled fields. Pattern off `WorkOrderDetailsAsset` so the two reports converge on one shape.

**Why this is blocking:** This is the customer-facing artifact and Equinix is the test case. If the report doesn't show the WO details, "battle-tested" isn't true yet.

---

### 2. Customer Report has known dead reads producing `—` on every report

**Where:** [app/api/pm-asset-report/route.ts:466-467, 478-480](app/api/pm-asset-report/route.ts:466)

```ts
// supervisorName previously read from check.completed_by (never existed —
// always rendered '—'). Preserved that visible behaviour pending a real
// sign-off column / lookup via audit_log.
supervisorName: '—',
…
reviewerName: null,
```

**What's happening:** The route comments admit `supervisorName` and `reviewerName` have *always* rendered as `—` / null because `maintenance_checks` has no `completed_by` column. The code preserves the bug deliberately as a known issue rather than fixing it.

Every Customer Report Equinix has ever received has had a blank supervisor / reviewer line on the sign-off page.

**Proposed fix (two options, prefer A):**
- (A) Read `check.assigned_to` for both fields. Same user typically completed and reviewed for a single-tech visit. Cheap, immediate value.
- (B) Add a real `completed_by` / `reviewed_by` column to `maintenance_checks` with a small UI on the completion flow. More work, but the right long-term shape.

For an Equinix-facing report under deadline, do (A) now, queue (B) for post-launch.

---

## 🟠 High

### 3. PDF work orders have no ingest path

**Where:** [app/(app)/maintenance/import/ImportWizard.tsx](app/(app)/maintenance/import/ImportWizard.tsx) only accepts `.xlsx`. The Delta parser is xlsx-only by design.

**What's happening:** Equinix sends both xlsx (the monthly Delta export) AND ad-hoc PDFs (Danny's email 2026-05-19, 7 WOs in 4 PDFs). The PDF path is currently 100% manual — go to `/maintenance/new`, retype site/plan/assets/date, attach the PDFs as evidence.

**Proposed fix:** This is the EQ Intake `maximo-pdf-wo` skill. Brief + fixture already prepped at `C:/Projects/eq-intake/eq-platform/packages/eq-validation/test/fixtures/equinix-maximo-pdf-wo-2026-05-19/` for the future build. Short-term: nothing changes in eq-service. Long-term: `/maintenance/import` (or `/do`) calls Intake → canonical bundle → same downstream flow as Delta xlsx.

Don't bolt a PDF parser onto eq-service — that's the per-customer-parser trap.

---

### 4. Field Run-Sheet test-kind synthesis only kicks in when `check_assets` is empty

**Where:** [app/api/maintenance-checklist/route.ts:197](app/api/maintenance-checklist/route.ts:197)

```ts
if (isTestKind && checklistAssets.length === 0) {
  // synthesize per-test rows…
}
```

**What's happening:** The kind-aware behaviour for ACB/NSX/RCD synthesizes ChecklistAsset rows from linked tests only when `check_assets.length === 0`. If someone creates a kind=acb check that happens to also have check_assets attached (legitimate — the asset under test is often also a check_asset), the test detail won't render and the tech gets the PPM-style task list instead of breaker/electrical/visual rows.

**Proposed fix:** Use `kind` as the primary discriminator, not asset count. If `kind in (acb,nsx,rcd)`, always synthesize from linked tests; ignore any check_assets present.

**Severity:** High because as soon as someone creates a hybrid check (PPM + ACB at the same visit), the run-sheet quietly drops the ACB detail.

---

### 5. Customer Report doesn't carry the per-asset work order number visibly enough

**Where:** [app/api/pm-asset-report/route.ts:174, 437](app/api/pm-asset-report/route.ts:174)

**What's happening:** `outstandingWOs` is counted on line 174 by checking `!ca.work_order_number`, and `workOrderNumber` is set on line 437 in `assetSections`. But whether the WO# is rendered prominently in the per-asset section needs eyes-on verification — the underlying generator at `lib/reports/pm-asset-report.ts` would need to be checked.

**Proposed fix:** Open one of the smoke-test outputs in `tmp/smoke/` and confirm. If the WO# isn't visible at the top of each asset section, fix the layout. WO# is the field Equinix references in every email.

**Action for Royce:** This needs your eyes. Smoke output is in `tmp/smoke/pm-asset-report-standard.docx`.

---

## 🟡 Medium

### 6. Field Run-Sheet has `maximoWONumber: null` hardcoded at check level

**Where:** [app/api/maintenance-checklist/route.ts:315](app/api/maintenance-checklist/route.ts:315)

```ts
maximoWONumber: null,  // Not stored at check level currently
```

**What's happening:** The run-sheet header has space for a single check-level WO#, but the route always passes `null` because WO#s live on `check_assets` not the parent check. The result is a blank field on every printed run-sheet.

**Proposed fix:** Two options:
- (A) Drop the field from `MaintenanceChecklistInput` since it's never populated.
- (B) Render a list of all check_asset WO#s when there are <= 5, or "Multiple (see asset sections)" otherwise.

(A) is honest. (B) is more useful. Either is fine — current state of "always blank" is worst-of-both.

---

### 7. Delta parser silently ignores Maximo classifications it doesn't recognise

**Where:** [lib/import/delta-wo-parser.ts:417-441](lib/import/delta-wo-parser.ts:417)

**What's happening:** The parser handles `priority`, `workType`, `crewId`, `targetFinish`, `failureCode`, `problem`, `cause`, `remedy`, `irScanResult`, `maximoTaskId` — all good. But it uses `cell('Crew') ?? cell('Crew ID')` and `cell('Target Finish') ?? cell('Sched Finish') ?? cell('TARGCOMPDATE')` — defensive aliasing for header variants. If Equinix ships a new variant column name, the parser silently treats it as null instead of warning.

**Proposed fix:** Add column-name suggestions to the unknown-column warnings. When the parser encounters a header that doesn't match REQUIRED_HEADERS or OPTIONAL_HEADERS, log it as a warning ("Found column 'XYZ' — was this supposed to map to ABC?"). Cheap.

---

### 8. `outstandingWOs` count is meaningless when `work_order_number` is per-check

**Where:** [app/api/pm-asset-report/route.ts:174](app/api/pm-asset-report/route.ts:174)

```ts
const outstandingWOs = checkAssets.filter(ca => !ca.work_order_number).length
```

**What's happening:** This counts check_assets without a WO# — but in the Equinix flow, every check_asset created by the Delta importer HAS a WO# (the parser fails the row if WO# is missing — line 449). For non-Delta-imported checks (manual creation via `/maintenance/new`), check_assets have no WO#, so the count would be `assetCount` and the metric becomes confusing ("4 of 4 assets are outstanding").

**Proposed fix:** Either drop the metric for non-imported checks, or rename to "Assets without a Maximo WO# linked" and show only when > 0 AND < total. Better: surface it only on Equinix-style imports.

---

### 9. Consolidated Delta import: same-site detection drives default but UI still lets you override mid-flight

**Where:** [app/(app)/maintenance/import/ImportWizard.tsx:96-100](app/(app)/maintenance/import/ImportWizard.tsx:96)

```ts
const [consolidate, setConsolidate] = useState(true)
…
// User-editable name for the consolidated check
```

**What's happening:** The consolidate toggle defaults true when files share a site; the user can flip it manually. If they flip OFF then ON mid-flight, the auto-generated name doesn't refresh because of the "hasUserEditedName" guard. Edge case — depends on the actual user behaviour you'd see in the field.

**Action for Royce:** This needs eyes-on testing with a real multi-file upload to see whether it bites in practice. Low priority unless you've felt it.

---

## 🟢 Polish

### 10. `raw_maximo_payload` is not actually a column — the memory framed it wrong

**Finding:** The memory `project_eq_service_canonical_migration.md` said PR #178 saved "the full Maximo payload per row" implying a JSON blob column. The actual implementation in PR #178 added 11 individually-typed columns (priority, work_type, crew_id, target_start, target_finish, failure_code, problem, cause, remedy, classification, ir_scan_result) plus `work_order_number`. That's cleaner than a JSON blob — typed columns are queryable.

**Action:** Update the memory wording to reflect the actual implementation. (Not a code change.)

---

### 11. Both report generators duplicate the `(brand ?? cb_make)` legacy/new column fallback

**Where:**
- [app/api/pm-asset-report/route.ts:266-294](app/api/pm-asset-report/route.ts:266) (`buildAcbDetail`, `buildNsxDetail`)
- [app/api/maintenance-checklist/route.ts:217-219](app/api/maintenance-checklist/route.ts:217)

**What's happening:** Both routes hand-wire `brand ?? cb_make`, `breaker_type ?? cb_model` etc. for the ACB/NSX legacy → new column migration (Sprint 1 Refs #101). When the migration finishes and the legacy columns get dropped, both routes will need updating.

**Proposed fix:** Extract a `resolveBreakerIdentity(row)` helper in `lib/reports/breaker-identity.ts` that both routes call. Single source for the fallback logic. Migration completion then touches one file.

---

### 12. Customer Report has a 60s maxDuration hint but underlying work isn't backgrounded

**Where:** [app/api/pm-asset-report/route.ts:40-41](app/api/pm-asset-report/route.ts:40)

```ts
export const runtime = 'nodejs'
export const maxDuration = 60
```

**What's happening:** At Jemena-scale (50+ linked tests across multiple sites) the comment says report generation approaches 20s. Netlify Pro caps synchronous functions at 26s. The 60s hint isn't honored on Pro plan — only on background functions.

**Proposed fix:** The comment already notes the design parked at `docs/architecture/report-delivery.md`. Confirm that doc exists; if not, write the design before Jemena scales further.

**Action for Royce:** Verify the parked design doc exists.

---

## Sequencing recommendation

If you want the punchlist as a work queue:

1. **Item 1 (Customer Report missing Maximo metadata)** — single biggest customer-visible gap.
2. **Item 2 (dead supervisor/reviewer reads)** — 30-minute fix, immediately visible improvement.
3. **Item 4 (test-kind synthesis edge case)** — defensive, but trivial.
4. **Item 5 (WO# visibility in Customer Report)** — needs your eyes first.
5. **Item 3 (PDF ingest)** — major work, but the Intake skill brief is ready when the canonical migration sprint picks it up.
6. Rest are cleanup; do as you touch the surrounding code.

## What's NOT in this punchlist

- **UI usability of the import wizard.** Needs you driving a browser. Items #5, #9 are flagged for your eyes-on review.
- **Generated docx visual review.** Smoke tests pass; outputs are at `tmp/smoke/`. Eyeball them next session.
- **Real production data run.** I don't have access to recent customer xlsx exports. The fixtures the smoke tests use cover the synthetic happy path.
- **Auth / RLS audit.** Out of scope — separate exercise.

## Companion artifacts

- **Fixture for future PDF skill:** `C:/Projects/eq-intake/eq-platform/packages/eq-validation/test/fixtures/equinix-maximo-pdf-wo-2026-05-19/`
- **Skill brief for `maximo-pdf-wo`:** `…/equinix-maximo-pdf-wo-2026-05-19/SKILL-BRIEF.md`
- **Smoke test output:** `C:/Users/EQ/AppData/Local/Temp/claude/…/tasks/b1oyq1fey.output` (3 files, 7 tests, all green)
- **Memory updates:** `project_intake_as_service_pattern.md` (new), `project_simpro_replacement_driver.md` (new), `project_eq_intake_owns_imports.md` (rewritten), `project_eq_service_canonical_migration.md` (refined)
