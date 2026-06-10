# Sprint 3b — ImportWizard extraction

**Source**: 2026-05-13 three-lens review, priority 3 (second target).
**Goal**: Split `app/(app)/maintenance/import/ImportWizard.tsx` (currently **2055 lines** — the largest single file in the codebase) into reviewable, testable surfaces.
**Risk**: VERY HIGH if rushed. Import is the highest-blast-radius workflow in the app: a bad import = corrupted check data across multiple sites in one operation. This warrants the most paranoid extraction approach.

This is a **focused-session sprint** — minimum half a day, probably full day. Not for overnight agents.

---

## Why this file is the riskiest extraction target

ImportWizard handles the monthly Equinix Delta WO `.xlsx` upload. As of PR #5 (multi-file consolidate mode), it does:

1. **Multi-file staging** — accepts ≥1 xlsx, each with its own parse status
2. **Per-file parsing** — Delta-shaped sheet → typed rows
3. **Site / asset / job-plan resolution** — name lookups against the tenant's data
4. **Conflict detection** — same WO# across files = hard error
5. **Consolidate toggle** — when ≥2 files for the same site are staged, merges into one `maintenance_check`
6. **Per-file preview** — shows what will be created/updated/skipped
7. **Frequency resolution** — picks most-common frequency across files (ties → earliest)
8. **Custom name field** — for consolidated checks
9. **Two-path commit** — single-file vs. consolidated
10. **Server-action submission** with idempotency
11. **Error handling** at every step

Plus enormous local state:
- Staged files list
- Per-file parse results
- Per-file preview cache
- Consolidate mode toggle
- Resolved site/customer per file
- Conflict list
- Selected frequency
- Custom name input
- Submission state
- Confirm-step state

The 2055 lines aren't redundant — they reflect real workflow complexity. **Extraction must preserve every state interaction.** A "looks simpler" refactor that drops a subtle edge-case handler will corrupt customer data.

---

## Recommended extraction order

This needs to be done MORE slowly than CheckDetailPage. Smaller steps, more verification per step, deeper test plan.

### Step 0 — Add a smoke test FIRST (BEFORE any extraction)

Before extracting anything, write a smoke test that runs the importer against a known-good sample file (or two known-good files for consolidate mode) and asserts the resulting `maintenance_checks` / `check_assets` rows match expected shape.

Location: `tests/lib/import/import-wizard.smoke.test.ts`. This test becomes your safety net — every extraction step must keep this test green.

**Without this test, do not start the extraction.** The blast radius is too high to refactor blind.

### Step 1 — Extract type definitions (TRIVIAL RISK)

The file likely has 10+ interface/type definitions at the top. Move them to `app/(app)/maintenance/import/types.ts`. Import them back. Pure code organisation.

Net line reduction: ~80.

### Step 2 — Extract parse logic into a hook (LOW RISK)

The file-parsing portion (Delta sheet → typed rows) is probably a pure function or a hook. Pull it into `app/(app)/maintenance/import/useDeltaParser.ts`. Receives a File, returns `{ rows, errors, frequency, siteCode }` or similar.

Verify the smoke test still passes.

Net line reduction: ~300.

### Step 3 — Extract conflict detection (LOW-MED RISK)

The WO# conflict detection across files is its own concern. Pull into `app/(app)/maintenance/import/conflictDetector.ts` (pure function) or `useConflictDetection.ts` (hook).

Test plan: feed it two files with overlapping WO numbers, assert the conflict surfaces.

Net line reduction: ~150.

### Step 4 — Extract the staged-files list UI (MED RISK)

The list view of staged files (with parse status + remove button) is a self-contained UI component. Extract to `app/(app)/maintenance/import/components/StagedFilesList.tsx`.

Props: `files`, `onRemove`, `onAdd` (or whatever the actual signatures are after extracting state).

Net line reduction: ~200.

### Step 5 — Extract the preview view (MED-HIGH RISK)

The per-file preview (and consolidated preview) is the user-facing "this is what will happen" surface. Highest visual surface. Most-tested-by-eye part of the workflow.

Extract to `app/(app)/maintenance/import/components/ImportPreview.tsx`. Pass it the resolved file data, the consolidate flag, the frequency, the custom name.

**Risk**: preview rendering has lots of branching by file state, consolidate mode, conflict presence. Easy to miss a branch. Verify each by clicking through.

Net line reduction: ~400.

### Step 6 — Extract the submit/commit flow (HIGH RISK)

The final commit step (calls `commitDeltaImportAction` or `commitConsolidatedDeltaImportAction`) is the load-bearing piece. If extraction drops a step (idempotency, the consolidate-mode branching, the error rollback), you corrupt customer data.

Extract LAST — only after all visual extractions are clean. Pull into a `useImportSubmit` hook returning `{ submit, submitting, submitError }`.

**Test plan**: end-to-end submit a single-file import; submit a consolidated multi-file import; submit one with a deliberate conflict; submit one with an idempotency replay (call twice with same mutationId).

Net line reduction: ~250.

---

## Recommended PR sequence

1. PR-A: Step 0 (smoke test) — must land BEFORE extraction begins
2. PR-B: Step 1 (types)
3. PR-C: Step 2 (parser)
4. PR-D: Step 3 (conflict detector)
5. PR-E: Step 4 (StagedFilesList)
6. PR-F: Step 5 (ImportPreview)
7. PR-G: Step 6 (useImportSubmit) — saves for last; biggest risk

Each PR auto-merge OFF. Each PR verified against the smoke test + manual import of a known-good sample. After PR-G, file should drop from 2055 to ~700.

---

## Don't extract these (yet)

- The consolidate-mode logic is intertwined with state and preview rendering. Don't try to split it out — it's coupled by design.
- The frequency-resolution helper. Live with the helper inline; not worth the cognitive cost of moving it out.
- The idempotency wrapping at the commit boundary. Keep that integrated with submit.

---

## Stop conditions

Stop the extraction if at any step:
- The smoke test breaks
- A manual import shows different behavior than before
- A PR diff exceeds 600 lines (extraction is dragging too much)
- A props list exceeds ~15 (boundary is wrong)

A 70%-extracted ImportWizard that's verifiably correct beats a 100%-extracted one that has a subtle regression.

---

## Why this matters

The CEO/Head of Construction lens in the 2026-05-13 review specifically called out: "bug velocity is masking how brittle some surfaces are." ImportWizard is the surface where bugs cost most — a single bad import affects every check across multiple sites. The extraction isn't aesthetic. It's making this surface debuggable when the inevitable next bug surfaces.

---

## History

| Date | Step | PR | Result |
|------|------|----|----|
| (none yet — runbook drafted 2026-05-13) | | | |
