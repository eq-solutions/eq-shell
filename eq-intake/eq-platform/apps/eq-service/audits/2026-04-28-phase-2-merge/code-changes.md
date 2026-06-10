# Phase 2 — Code changes checklist

DRAFT for review. These edits ship in the same PR as `migration-0072-draft.sql` so the application stops writing to `testing_checks` the moment the migration lands.

## Files that read or write `testing_checks`

| File | Type | Change |
|---|---|---|
| `app/(app)/testing/check-actions.ts` | server actions | Switch INSERT, UPDATE, archive to `maintenance_checks` (set `kind`). Remove `name` field — use `custom_name`. Convert month/year to start_date + due_date. |
| `app/(app)/testing/summary/page.tsx` | server component | Switch the dashboard query to `maintenance_checks` filtered by `kind IN ('acb','nsx','general')`. Replace `check.name` with `check.custom_name`, `check.check_type` with `check.kind`. |
| `app/(app)/admin/archive/helpers.ts` | helper | Update the entity-type map: `testing_check → maintenance_checks` (or drop the entry if maintenance-checks entry already covers it). Update the orphan-count queries on lines 71, 96, 97 to query maintenance_checks where kind != 'maintenance'. |
| `lib/types/index.ts` | types | Drop `TestingCheck` interface or re-alias to `MaintenanceCheck & { kind: 'acb'\|'nsx'\|'general' }`. Audit the two `testing_check_id` references at lines 464 and 585 — keep the column name during transition; rename in follow-up. |

## Files that reference `testing_check_id` (column on acb_tests/nsx_tests)

These do NOT need to change in this PR — the column name stays. They'll be touched in the follow-up rename migration.

- `app/(app)/admin/archive/helpers.ts:96-97`
- `app/(app)/testing/summary/page.tsx:79, 106`
- `lib/types/index.ts:464, 585`

## Audit log entity type

- `audit_logs.entity_type` currently includes `'testing_check'` for testing-check-create events.
- After merge, new check creates write `entity_type = 'maintenance_check'` (the existing convention) regardless of kind.
- Existing `'testing_check'` rows in `audit_logs` stay as-is — they're a historical record, not actively read.

## Tests / type-check

- `npm run check` (tsc + next build) must pass before push.
- Manual sanity:
  - `/testing/summary` still loads, shows the same checks.
  - `/testing/acb` "Create Check" flow still creates a row that appears in Summary.
  - `/admin/archive` shows checks in their right grace-period state.

## Out of scope for this PR (follow-ups)

1. **Rename `testing_check_id` → `check_id`** on acb_tests + nsx_tests (matches rcd_tests). Migration + code update. Cleanup-only change.
2. **Drop `testing_checks` table** (migration 0073). After the transition window has run for ~1 sprint and no code references the table.
3. **Embed Testing into `/maintenance/[id]`** (Phase 3). Pull linked acb/nsx/rcd tests on the maintenance check detail page and render appropriate panels per asset.
4. **Unified workflow shell** (Phase 4).
5. **Site Visit Report** (Phase 5) — single PDF on `/maintenance/[id]` bundling everything done that visit.
6. **301 redirects** for `/acb-testing` and `/nsx-testing` (Phase 1, can ship anytime, cheap).
