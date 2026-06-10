# 2026-04-26 — Service Items Review (Sprints 1–4)

Source: `EQ Service items 26.4.26.xlsx` — Royce's 14-item review punch list.
HTML explainer with full decision log: `docs/reviews/2026-04-26-service-items-decisions.html`.

## What we built

### Sprint 1 — UI polish & quick wins (all done)

1. **Logo upload silent fail** — `customers/actions.ts` and `sites/actions.ts` now revalidate the dynamic `/[id]` detail routes (and cross-revalidate sites ↔ customers). Was list-only before, which is why detail pages didn't refresh after a logo change.
2. **Loading patterns** — `Button` gained a `loading` prop (inline spinner + disabled). New `Skeleton`, `SkeletonRows`, `SkeletonCards` for table/data placeholders. RouteProgress was already wired globally.
3. **Dashboard switcher relabel** — "My Work / All Work" → "Assigned to Me / All Active Work" (`DashboardViewToggle.tsx` + `dashboard/page.tsx`). Underlying filter on `maintenance_checks.assigned_to` is unchanged.
4. **Users archive + super_admin delete** — Archive (any admin) preserved as soft-remove from tenant. New `hardDeleteUserAction` (super_admin only) with double-confirm (typed-name match) wipes from `auth.users`. Page gained a `?show_archived=1` toggle that hides removed users by default and shows a count badge for how many are archived.

### Sprint 2 — Reporting unification (foundation laid)

1. **`ReportShell`** — `lib/reports/report-shell.ts` with `buildCover` / `buildHeader` / `buildFooter` / `buildSignoff` driven by Report Settings + per-call overrides. All future PDF generators compose against this.
2. **Maintenance check report UI** — replaced "Print — Simple" / "Print — Detailed" with a single `SplitButton` (primary action + caret). Default click runs Standard; caret opens Summary / Standard / Detailed picker. API route normalises legacy `format=simple` to `summary`.
3. **Apply ReportShell to all PDFs** — deferred. Each generator (ACB / NSX / Compliance / PM / Defect register) migrates incrementally as it's next touched, rather than rewriting all 8 in one risky pass.
4. **Live preview** — already existed in `ReportSettingsForm.tsx` (left/dark + right/light A4 preview); marked complete during scoping.

### Sprint 3 — Data & workflow

1. **Attachments wipe + categorize** — migration `0060` truncates the table and adds `attachment_type` (`evidence` | `reference` | `paperwork`) with a check constraint. `AttachmentList.tsx` asks the user to pick a Type on every upload (with sensible defaults inferred from `entityType`). Existing list items render their Type inline. Bucket wipe still pending — needs an out-of-band step (SQL TRUNCATE doesn't reach object storage).
2. **Defects auto-population** — migration `0061` adds `source` + `source_check_item_id` columns and trigger `fn_check_item_to_defect`. On `result='fail'` it creates a defect (severity = medium for check items). On un-fail it auto-resolves the defect with a resolution note. ACB/NSX triggers will follow with the `Visual=low / Functional=medium / Electrical=high` rule once those tables' fail signals are mapped.
3. **Edit-after-completion + audit** — `reopenCheckAction` in `maintenance/actions.ts` and a "Re-open" button on the completed-state header in `CheckDetailPage.tsx`. Status flips back to `in_progress`, audit log captures the amend. No reason field (per Royce's decision — keep friction low).

### Sprint 4 — New surfaces

1. **Contacts CSV import** — `app/(app)/contacts/actions.ts::importContactsAction`. CSV columns: `customer`, `site` (optional), `name`, `email`, `phone`, `role`. Customer/site name lookups done in-memory before insert; per-row errors returned for unmatched names. Wired through `ImportCSVModal` from `ContactList.tsx`.
2. **Calendar — month grid first + status overlay** — page default view now `calendar` (was `list`). New StatusStrip cards above the toolbar (Overdue / This Week / Looking Ahead / Completed). Each entry in the month grid carries a colour-coded left border via `timingBorderClass`. The grid itself was already a 12-month layout.

## Decisions Royce locked in

| # | Question | Choice |
| - | -------- | ------ |
| Calendar | Replace Outlook? | Catch-what-Outlook-misses (overdue/upcoming gaps) |
| Contacts | Model | Per-customer + per-site, optional roles |
| Edit completed | Who | Any technician with audit |
| Users | Removal | Archive + super_admin hard delete |
| Test reports | Granularity | All assets in the check, cover page, 3 styles |
| Defects | Population | Auto from failed tests + manual |
| Contract scope | Behaviour | Reference now → inline on relevant checks (future) |
| Dashboard | Toggle | All Active Work ↔ Assigned to Me |
| Reports template | Scope | Every PDF uses Report Settings |
| Attachments | Categorisation | Evidence / Reference / Paperwork |
| Print UI | Format | Single button + dropdown caret |
| Assignment UI | When | At creation + reassign anytime |
| Loading UX | Pattern | Inline spinner + skeletons + top progress bar |
| Calendar views | First | Month grid (calendar-feeling) |
| Defect severity | Rule | Visual=Low, Functional=Medium, Electrical=High |
| Existing attachments | Backfill | Hard reset (Royce confirmed wipe + repopulate Demo) |
| Amend trigger | UX | Re-open button, no reason required |
| Contacts CSV | Schema | Customer / Site / Name / Email / Phone / Role |

## Phase-2 (same session)

After the first pass, Royce asked to push everything through. Done:

- **Migrations 0060–0064 applied live** to `urjhmkhbgaxrofurpbgc`. Verified via `supabase_migrations.schema_migrations`.
- **0062 — ACB / NSX / generic test_records defect triggers**. Severity per Royce's rule: Visual=low, Functional=medium, Electrical=high, default medium. Helper function `fn_severity_from_reading_label(text)` keys off label keywords. Reverse-on-pass auto-resolves the defect.
- **0063 — `assigned_to` on `acb_tests` / `nsx_tests` / `test_records`**, with filtered indexes. Lets the dashboard "Assigned to Me" filter drill below check level.
- **0064 — `contract_scopes` gains `asset_id` + `job_plan_id`** (both nullable) so a scope row can pin to a specific asset or job-plan family. Matched index pair.
- **`ContractScopeBanner`** server component, wired into `app/(app)/maintenance/[id]/page.tsx`. Renders matched scope items with precedence: asset → job_plan → site → customer. FY-filtered. Out-of-scope items get amber chip (visible warning); in-scope get green.
- **`compliance-report.ts` adopts ReportShell** as the first migrated generator. Header + Footer come from the shell. Pattern documented in code so the remaining 7 generators are a copy-paste migration at next touch.
- **`scripts/seed-demo-attachments.ts`** — idempotent Node script that uploads placeholder PNGs + inserts metadata across the three Type categories.
- **Demo metadata seed** — 19 rows inserted via SQL (6 evidence, 8 reference, 5 paperwork). UI looks populated even before the script runs.
- **Severity helper bugfix** — dropped bare `label` from the visual regex (was matching arbitrary text). Synced fix to migration file.

## Still pending (you, locally)

- `npx tsc --noEmit` from repo root — Cowork can't run TS itself. Verify clean before push.
- Push to main (your push script).
- Optional: `npx tsx scripts/seed-demo-attachments.ts` if you want the Demo placeholder bytes physically uploaded (metadata is already in DB).
- The 7 remaining PDF generators migrate to ReportShell at next touch. Pattern is one import + two function calls; see `compliance-report.ts` lines around the shell adoption block.
- 2 orphan storage objects (390 kB SKS logo + 13 kB SKS report DOCX) still in `attachments` bucket — wipe via the PowerShell snippet sent earlier if you want a fully clean bucket.
