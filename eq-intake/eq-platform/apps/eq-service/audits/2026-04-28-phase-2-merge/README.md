# Phase 2 — Merge testing_checks into maintenance_checks

DRAFT for review. Nothing in this folder has been applied or pushed.

## TL;DR

Today the app has two parallel "check" concepts:

```
testing_checks       ← /testing tab. Owns acb_tests + nsx_tests.
maintenance_checks   ← /maintenance tab. Owns rcd_tests (after PR #21).
                       The two don't talk.
```

After Phase 2, there is one:

```
maintenance_checks
  ├─ kind = 'maintenance'   ← standard PPM (the existing rows)
  ├─ kind = 'acb'           ← what testing_checks called check_type='acb'
  ├─ kind = 'nsx'           ← what testing_checks called check_type='nsx'
  ├─ kind = 'rcd'           ← future-flagged (RCD checks already live here)
  └─ kind = 'general'       ← what testing_checks called check_type='general'
```

`acb_tests` and `nsx_tests` keep their `testing_check_id` column for now — the FK just gets repointed at `maintenance_checks(id)`. Same UUIDs, no data loss. Column rename ships in a follow-up PR.

## Files in this folder

| File | Purpose |
|---|---|
| `migration-0072-draft.sql` | The forward migration. Drops testing_checks table, replaces with a read-only view. |
| `rollback-0072.sql` | Reverses 0072. Re-creates the table from view-backing data. |
| `code-changes.md` | Application files that need to switch from `testing_checks` to `maintenance_checks`. |
| `README.md` | This file. |

## Decisions locked (working session 2026-04-28)

### Q1 — Who can create a check after the merge? → **Loosen RLS**

Add `'technician'` to the `maintenance_checks` INSERT policy. Aligns RLS with the application's `canWrite()` helper. Preserves the "tech arrives onsite, hits Create Check" flow that exists today via the testing tab. The previous `'Admin and supervisor can create checks'` policy is dropped and replaced.

### Q2 — What to do with the old testing_checks table? → **Read-only VIEW**

Drop the table after backfill, replace with a view: `CREATE VIEW testing_checks AS SELECT … FROM maintenance_checks WHERE kind IN ('acb','nsx','general')` with `security_invoker = true` so RLS still applies. Existing reads (e.g. `/admin/archive/helpers.ts`) keep working transparently. Writes fail loudly because the view isn't updatable — caller code knows to migrate to `maintenance_checks`. Drop the view in a tiny follow-up once nothing reads it.

### Q3 — Rename `testing_check_id` → `check_id`? → **Follow-up PR**

Column name stays as `testing_check_id` in this migration. Rename is a separate, mechanical PR that ships after the merge has been smoke-tested. Cleaner separation of concerns.

### Q4 — What about historical audit_logs entries? → **Leave + comment**

Old rows with `entity_type = 'testing_check'` stay intact. Backfilling would rewrite history and lose audit fidelity. New writes use `'maintenance_check'`. Add a `COMMENT ON COLUMN audit_logs.entity_type` explaining for future readers why both values appear.

## How the migration works (summary)

1. Add `kind` and `created_by` columns to `maintenance_checks`. Default `kind='maintenance'` so existing rows aren't disturbed.
2. Lift the `NOT NULL` on `maintenance_checks.job_plan_id` (multi-plan checks already pass null at the app layer).
3. `INSERT … SELECT` every `testing_checks` row into `maintenance_checks`, **preserving the same UUID**. month/year → first-of-month for `start_date` and `due_date`. status maps directly. frequency coerced to a known enum value.
4. Drop the FK constraints on `acb_tests` and `nsx_tests` pointing at `testing_checks`.
5. Drop the `testing_checks` table.
6. Create the read-only `testing_checks` view backed by `maintenance_checks` (Q2 decision).
7. Add new FK constraints on `acb_tests` and `nsx_tests` pointing at `maintenance_checks`.
8. Replace the `maintenance_checks` INSERT RLS policy to include `'technician'` (Q1 decision).
9. Add the `audit_logs.entity_type` comment (Q4 decision).

## Rollback

`rollback-0072.sql` reverses everything: drops the view, re-creates the table, restores data from `maintenance_checks`, restores original FKs and RLS policy, drops the new columns. The only risk is rows created post-migration via the new code path — the rollback file includes a manual back-copy block at the bottom for that case.

## Effort estimate

- Migration apply: minutes (small data — testing_checks today has tens of rows, not thousands).
- Code refactor: half a day (4 files, mechanical).
- `npm run check` + manual smoke: half a day.
- Total: ~1 day to land in main.

## What this PR does NOT do

- Does NOT embed Testing into `/maintenance/[id]` (that's Phase 3).
- Does NOT unify the ACB/NSX/RCD workflow shell (Phase 4).
- Does NOT add the Site Visit Report (Phase 5).
- Does NOT 301-redirect the legacy `/acb-testing` and `/nsx-testing` routes (Phase 1, easy to ship alongside or before).
- Does NOT rename `testing_check_id` → `check_id` (follow-up PR).

This is purely the data-model unification. Everything downstream gets easier after this lands.
