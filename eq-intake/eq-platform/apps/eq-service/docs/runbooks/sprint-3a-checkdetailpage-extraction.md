# Sprint 3a — CheckDetailPage extraction

**Source**: 2026-05-13 three-lens review, priority 3.
**Goal**: Split `app/(app)/maintenance/[id]/CheckDetailPage.tsx` (currently 965 lines) into ≤300-line surfaces. Reduce cognitive load on the file techs hit daily.
**Risk**: HIGH if rushed. The file has dense state interactions; subtle regressions are easy and hard to detect without manual flow testing.

This is a **daytime sprint** — not a midnight one. Plan first, extract second, verify against a real check third.

---

## Why this file is hard

`CheckDetailPage.tsx` is the surface technicians use every visit. It currently combines:

1. **Header**: status badge, breadcrumb, action buttons (Start, Complete, Reopen, Delete, Send Report, Field Run-Sheet, Print Blank).
2. **Asset table**: sortable + filterable + selectable, ~30 columns of rendering logic.
3. **Inline editing**: WO numbers and notes per row, with optimistic UI.
4. **Item editing**: pass/fail/NA per task, with the in_progress vs. complete branching that audit finding #1 exposed.
5. **Bulk operations**: Force Complete (single), Complete All Assets, Batch Complete Selected, Paste WOs.
6. **Modals**: WO Paste modal, Send Report modal, Customer Report download dialog.
7. **Sub-components in the same file**: `PrintBlankButton`, `PrintReportSplit`.

Shared client state at the page level:
- `error`, `loading`, `forceCompletePending`
- `expandedAssetId`, `sortKey`, `sortDir`, `filterText`
- `showPasteModal`, `pasteText`
- `selectedAssetIds`
- `showSendReport`, `showReportDialog`
- `router` (Next.js useRouter)

Plus: a `useMemo` for sorted/filtered assets, a `useMemo` for displayed assets, a dozen handler functions wired into the asset table.

**Extraction risk**: lifting any of this into a child component without correctly threading the state/handlers breaks the surface. Common failure modes are (a) optimistic UI no longer rolls back on failure, (b) router.refresh() called from the wrong place, (c) form refs lost across re-renders.

---

## Recommended extraction order

Each step should ship as its own PR — small, reviewable, verifiable. Do not bundle. Run `npm run check` before each commit, and do a manual smoke against a real demo-tenant check.

### Step 1 — Move sub-components into their own files (LOW RISK)

`PrintBlankButton` (lines 60-77) and `PrintReportSplit` (lines 79-110) are already self-contained. Move them to `app/(app)/maintenance/[id]/components/PrintBlankButton.tsx` and `.../PrintReportSplit.tsx`. Pure code organisation; no behavior change.

Net line reduction: ~50.

### Step 2 — Extract the WO Paste modal (LOW-MED RISK)

The WO Paste modal section (search for `showPasteModal` in the JSX) is a self-contained workflow:
- Reads `pasteText`, `sortedAssets`, `check.id`, `setLoading`, `setError`, `setShowPasteModal`, `setPasteText`
- Calls `bulkUpdateWorkOrdersAction`
- Renders a Modal component

Extract to `app/(app)/maintenance/[id]/components/WoPasteModal.tsx`. Pass `check`, `sortedAssets`, `onClose`, and an `onComplete` callback as props. Hoist the `handlePasteWOs` logic into the child component (it has no other dependencies outside the paste flow).

**Risk**: the audit's Finding 4 fix lives in `handlePasteWOs` (partial-failure handling). Make sure the extracted version preserves the `failed[]` handling, the modal-stays-open-on-partial-failure behavior, and the setError pathway.

Net line reduction: ~80.

### Step 3 — Extract the Asset Table (MED RISK)

The asset table is the largest single chunk. It includes:
- The table header with sortable columns + select-all checkbox
- The filter input
- The row rendering (delegated to `AssetRow` already, good)
- The bulk action bar (Complete N Selected)
- The empty state

Extract to `app/(app)/maintenance/[id]/components/CheckAssetSection.tsx`. Props:
- `assets: CheckAsset[]`
- `items: MaintenanceCheckItem[]`
- `displayedAssets: CheckAsset[]`
- `sortKey`, `sortDir`, `filterText`
- `selectedAssetIds`
- Handlers: `onSort`, `onFilterChange`, `onToggleSelection`, `onToggleAll`, `onItemResult`, `onItemNotes`, `onAssetNote`, `onAssetWO`, `onForceComplete`, `onBatchComplete`
- `expandedAssetId`, `setExpandedAssetId`
- `canAct`, `pending`

That's a lot of props. **This is the warning sign**: if the prop list exceeds ~12, the extraction is dragging shared state along instead of encapsulating. Consider whether the `useMemo`s and a slice of handlers should move WITH the table extraction.

**Risk**: the `displayedAssets` useMemo depends on `sortedAssets` which depends on `checkAssets`, `items`, `sortKey`, `sortDir`. The `filterText` then trims. If you split the memos across the parent and the child, you risk double-computation or stale snapshots.

Recommendation: keep the memos in the parent for now. Extract the JSX only, not the memos. Net line reduction: ~250.

### Step 4 — Extract handler functions (LOW RISK)

The handlers (`handleItemResult`, `handleItemNotes`, `handleAssetNote`, `handleAssetWO`, `handleForceComplete`, `handleStart`, `handleComplete`, `handleCompleteAll`, `handleBatchComplete`, `handleDelete`, `handleDownloadReport`) are ~250 lines combined.

Move them to a custom hook: `useCheckDetailHandlers(check, items, checkAssets, dependencies)` returning the handler object. Keeps the JSX section cleaner.

**Risk**: handlers close over a lot of state. Make sure the hook receives or re-derives every dependency. Use `useCallback` where appropriate to prevent re-renders.

Net line reduction: ~200.

---

## Recommended PR sequence

1. PR-A: Step 1 (sub-components) — 50 lines
2. PR-B: Step 2 (WoPasteModal) — 80 lines
3. PR-C: Step 3 (CheckAssetSection) — 250 lines, the big one
4. PR-D: Step 4 (handlers hook) — 200 lines

Each PR auto-merge OFF, each verified against a demo-tenant check before merge. Total: 580 lines extracted, file drops from 965 to ~385.

**Do not aim for ≤300 in one PR.** Each step is its own review burden. The full sequence is a sprint of focused work, probably 1-2 days of dev time.

---

## Test plan (per PR)

- `npm run check` clean (tsc + next build)
- Sign in as admin, navigate to a known check on the demo tenant
- Verify every interaction still works:
  - Start / Complete / Reopen / Delete buttons
  - Asset table sort by every column
  - Asset table filter (case-insensitive substring on name + maximo id + location)
  - Select all / individual checkboxes
  - Complete N Selected (with a small selection)
  - Force Complete (single asset)
  - Item pass/fail/NA toggle from in_progress AND complete states
  - Item notes save
  - Asset WO inline edit
  - Asset note inline edit
  - Paste WOs modal (with both valid and partial-failure cases)
  - Send Report modal
  - Customer Report download
  - Field Run-Sheet (all three formats)
  - Print Blank for Onsite
- Spot check the audit findings #1-4 are still fixed (no silent failures)

---

## When NOT to extract

If at any step the props list exceeds ~12 OR the diff in any one file exceeds 400 lines, **stop and rethink**. The extraction is dragging too much context. Either find a tighter boundary OR ship the partial extraction and revisit the rest later.

The goal is "techs' daily driver is easier to debug and modify", not "smallest file possible at any cost."

---

## History

| Date | Step | PR | Result |
|------|------|----|----|
| (none yet — runbook drafted 2026-05-13) | | | |
