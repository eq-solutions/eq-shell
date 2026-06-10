# Equinix workflow — continued audit + fixes shipped

Companion to [equinix-workflow-punchlist.md](equinix-workflow-punchlist.md). Royce green-lit autonomous fix work after the initial audit: "we have no customers, users — if you break things we can fix, i am in favour of productivity than caution for this."

This file captures:
1. Status of every original punchlist item (fixed / deferred / needs-eyes)
2. New findings from the continued audit
3. Commits shipped on this branch

---

## Original punchlist — status

| # | Severity | Item | Status | Commit |
|---|---|---|---|---|
| 1 | 🔴 Blocking | Customer Report doesn't render Maximo metadata | ✅ FIXED | `34e190a` |
| 2 | 🔴 Blocking | Customer Report dead supervisor/reviewer reads | ✅ FIXED | `34e190a` |
| 3 | 🟠 High | PDF work orders have no ingest path | Deferred to EQ Intake skill (fixture + brief prepped) | — |
| 4 | 🟠 High | Field Run-Sheet kind discriminator | ✅ FIXED | `8b599e8` |
| 5 | 🟠 High | WO# visibility in Customer Report | **Needs your eyes** — open `tmp/smoke/pm-asset-report-standard.docx` and confirm the per-asset WO# is prominent | — |
| 6 | 🟡 Medium | Run-sheet `maximoWONumber` always null | ✅ FIXED | `8b599e8` |
| 7 | 🟡 Medium | Delta parser silently ignores unknown columns | ✅ FIXED | `a750dfe` |
| 8 | 🟡 Medium | `outstandingWOs` metric misleading | ✅ FIXED | `566a1c5` |
| 9 | 🟡 Medium | Consolidate toggle edge case | **Needs your eyes** — real multi-file upload test | — |
| 10 | 🟢 Polish | `raw_maximo_payload` memory framed wrong | ✅ FIXED — memory updated 2026-05-21 | — |
| 11 | 🟢 Polish | Duplicate `brand ?? cb_make` logic | ✅ FIXED — extracted [breaker-identity.ts](lib/reports/breaker-identity.ts) | `ae78016` |
| 12 | 🟢 Polish | 60s maxDuration on PM asset report | **Needs your verification** — confirm `docs/architecture/report-delivery.md` exists | — |

**7 of 12 original items shipped.** 3 need your eyes (UI / verification). 2 are doc/memory updates only. 1 deferred to a larger Intake skill build.

---

## New findings from continued audit (2026-05-21)

### Already fixed during this run

#### 🟡 Audit-log gaps in 6 maintenance actions
**Status:** ✅ FIXED — `9f45d98` + `fb1abb2`

`maintenance/actions.ts` had 6 mutating server actions that wrote to `check_assets` or `maintenance_check_items` without an `audit_logs` row, despite peer actions logging every flip. Now all log:

- `completeAllCheckAssetsAction` — bulk "Complete All Assets" button
- `batchForceCompleteAssetsAction` — bulk force-complete subset
- `updateCheckItemResultAction` — every per-task pass/fail/na flip (high-frequency)
- `forceCompleteCheckAssetAction` — per-asset force-complete
- `bulkUpdateWorkOrdersAction` — bulk WO# paste (logs count + failures)
- `updateCheckAssetAction` — single-asset notes / WO# edit

Compliance evidence trail is now complete across the maintenance write surface.

#### 🟢 Misleading reopen-check comment
**Status:** ✅ FIXED — `9f45d98`

`reopenCheckAction` comment claimed it bumped an `amended_at` column on each re-open. The column doesn't exist; the code only flips status. Corrected the comment and flagged `amended_at` as a known follow-up — `audit_logs` is the source of truth for re-open history until the column lands.

### Findings — not yet fixed (worth your input)

#### ❌ ~~No dispatch / "today's jobs" view exists~~ — RETRACTED 2026-05-21
Earlier framing claimed eq-service should grow a `/dispatch` view to fill a Simpro gap. **Wrong call.** Resource management — dispatch, "who's where today", labour hire, staff licences, availability — lives in **EQ Field**, which is already built and polished. eq-service consumes Field's resource data via the canonical layer; it does not own a parallel dispatch surface. The `/calendar` page in eq-service may evolve into a labour coordination surface (block-out dates for nominated techs, labour-meeting reminders) but that's distinct from dispatch.

See `~/.claude/projects/C--Projects-eq-solves-service/memory/project_field_service_boundary.md` for the canonical ownership table.

#### ⚪ Defect → Quote cross-app linkage — parked 2026-05-21
Royce 2026-05-21: "eq quotes won't be relevant for this just yet." The defect → quote remediation loop is deferred. DefectRow stays as-is until the cross-app surface is the next deliberate piece of work.

#### ⚪ `/do` common-ops tiles — parked 2026-05-21
Royce 2026-05-21: "ignore common ops tiles for now." Skip.

#### 🟡 Defect actions lack Zod validation
**Status:** ✅ FIXED — `81cb8a3`

Added `lib/validations/defect.ts` with `RaiseDefectSchema` + `UpdateDefectSchema`. Both `raiseDefectAction` and `updateDefectAction` now `safeParse()` at the top per the AGENTS.md security invariant.

#### 🟡 `amended_at` column doesn't exist but reopen design called for it
The reopen action was supposed to bump a per-amend timestamp distinct from `completed_at`. The column was never added; the comment misleadingly claimed it was bumped. Comment is now corrected (see fixed list above). If amendment timeline becomes a first-class report field, add `amended_at` to `maintenance_checks` via migration and bump it on every reopen.

#### 🟢 `propagateCheckCompletionIfReady` swallows errors with only console.error
**Status:** ✅ FIXED — `dc2e32d`

Added `Sentry.captureException` alongside the existing `console.error` so production has signal when propagation fails silently. Pattern matches the slow-report canary in `lib/observability/report-duration-canary.ts`.

---

## Commit history on this branch

```
ff1ce8e  docs: equinix workflow battle-test punchlist (initial audit)
34e190a  fix: customer report renders Maximo WO metadata + real supervisor name
8b599e8  fix: field run-sheet uses kind as test-detail discriminator + WO summary
a750dfe  fix: delta parser warns when unknown columns are in row 1
566a1c5  fix: outstandingWorkOrders only renders when meaningful
ae78016  refactor: extract breaker-identity helper for ACB/NSX fallback
9f45d98  fix: add audit logs to completion-flow actions + correct reopen comment
fb1abb2  fix: audit-log the remaining check_asset mutation actions
16683ac  docs: continued-audit followup with status + new findings
81cb8a3  fix: Zod validation on raiseDefectAction + updateDefectAction
dc2e32d  fix: Sentry capture on propagateCheckCompletionIfReady failure
```

11 commits, plus the corrections commit landing alongside this doc edit. Branch is `claude/nervous-heisenberg-086c97`.

## Test status

- `tsc --noEmit` clean across all changes
- 199 tests passing across 12 test files
- Smoke test fixture extended to exercise the new Maximo metadata + failure-chain rendering paths

## What's outside this branch

- **EQ Intake fixture** for the future `maximo-pdf-wo` skill — Danny's 4 PDFs + README + SKILL-BRIEF.md at `C:/Projects/eq-intake/eq-platform/packages/eq-validation/test/fixtures/equinix-maximo-pdf-wo-2026-05-19/`
- **Memory updates** in `~/.claude/CLAUDE.md` (global) and `~/.claude/projects/C--Projects-eq-solves-service/memory/` (project) — including the new EQ Suite architecture map (Field as resource owner, eq-service as CMMS consumer) and the canonical Cards → Shell/Canonical → Field flow.

## What's next (locked by Royce 2026-05-21)

- **EQ Quotes integration** — parked, not relevant now
- **`/do` common-ops tiles** — parked, ignored for now
- **Maximo PDF skill** — built in EQ Intake, not eq-service. Fixture + SKILL-BRIEF.md ready under `C:/Projects/eq-intake/eq-platform/packages/eq-validation/test/fixtures/equinix-maximo-pdf-wo-2026-05-19/`. Picks up when the canonical migration sprint runs.

Any future "should we build a /dispatch view in eq-service?" prompt should be redirected to EQ Field, per the EQ Suite architecture map in global CLAUDE.md.
