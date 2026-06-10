# EQ Solves Service

Multi-tenant maintenance management platform for electrical contractors — circuit breaker testing, maintenance checks, defect tracking, and reporting.

## Project Details

- **Local path**: `C:\Projects\eq-solves-service`
- **Git repo**: https://github.com/Milmlow/eq-solves-service.git
- **Supabase project ID**: `urjhmkhbgaxrofurpbgc`
- **Deployment**: Netlify (auto-deploy from main branch)
- **Framework**: Next.js 16 + React 19 + Supabase + Tailwind CSS 4

## Key Patterns

### Database (Supabase)
- Row-Level Security via `public.get_user_tenant_ids()` and `public.get_user_role(tenant_id)` — all tables enforce tenant isolation
- Trigger function `public.set_updated_at()` auto-maintains `updated_at` timestamps
- Migrations in `supabase/migrations/` — the directory itself is the source of truth (numeric counts here bit-rot fast)
- Storage buckets: `attachments` (general files), `logos` (tenant + customer logos, public bucket with auth RLS)

### Auth & Roles
- `auth.uid()` resolves the current user via Supabase Auth
- `tenant_members` table maps users → tenants with roles: `super_admin`, `admin`, `supervisor`, `technician`, `read_only`
- App-layer role checks via `canWrite(role)` and `isAdmin(role)` from `lib/utils/roles`
- **Tenant assignment on signup:** The `handle_new_user()` trigger (migration 0053) creates a `profiles` row only — it never assigns `tenant_members`. Tenant membership is assigned by the `inviteUserAction` server action, or auto-assigned via `tenant_settings.default_tenant_for_new_users` if configured (migration 0046). Users without a `tenant_members` row hit a clear "No tenant assigned" screen in `app/(app)/layout.tsx` (no silent fallthrough to demo tenant). The `/admin/users` page surfaces orphaned users with an Attach button (`repairUserTenantAction`).
- **MFA history (regression watch):** MFA was historically unstable — an AAL1 challenge loop between signin and `/auth/mfa` was fixed 2026-04-26 by adding `/auth/signin` to `AAL_EXEMPT_PATHS` in `proxy.ts` so users with stale AAL1+TOTP sessions can sign out and start fresh. PostHog `mfa_redirect` events are emitted on every AAL gate bounce so any recurrence is visible (two redirects within ~30s for the same user = suspected loop). Re-verify on any auth-related change.
- **Tenant IDs:** SKS = `ccca00fc-cbc8-442e-9489-0f1f216ddca8`, Demo = `a0000000-0000-0000-0000-000000000001`

### Server Actions
- All mutations use Next.js server actions in `app/(app)/*/actions.ts`
- Pattern: `requireUser()` → role check → Zod validation → Supabase mutation → audit log → `revalidatePath()`

### UI
- Custom component library in `components/ui/` (no shadcn) — uses Tailwind tokens: `eq-sky`, `eq-deep`, `eq-ice`, `eq-ink`, `eq-grey`
- Client components use `createClient()` from `lib/supabase/client`
- `SearchFilter` component uses URL params for server-side filtering

### UI cosmetic decisions (2026-04-28 sweep)

These are the canonical decisions from PRs E–J. New surfaces should follow them; non-conforming surfaces get migrated when next touched.

- **StatusBadge** (`components/ui/StatusBadge.tsx`) is the canonical status pill across the app. Has `tone="soft" | "solid"`, `size="sm" | "md"`, and a leading coloured `dot` (default true). Inline `<span>` pills with hard-coded `bg-*-50 text-*-700` are the targets for migration — replace as you find them.
- **Sidebar grouping** (`components/ui/Sidebar.tsx`) — items live in `navSections` (Data / Operations / Insight + unlabeled Dashboard, Search/Settings groups). Active items get a left-side accent strip via `before:` pseudo-element. Section labels use the existing Admin block's `text-[10px] uppercase tracking-wider text-white/30` style.
- **Maintenance check page (`/maintenance/[id]`)** has a status-driven hairline accent at the top (green=complete, red=overdue, amber=in_progress, gray=cancelled, sky=scheduled). Title is `text-3xl text-eq-ink tracking-tight`. Section order: header → Linked Tests → Attachments → Asset table (last). Asset table has a free-text filter (name / Maximo ID / location) and sortable column headers.
- **Maintenance list (`/maintenance`)** has a `Type` (kind) column rendered as a coloured `KindPill` (PPM=sky, ACB=purple, NSX=indigo, RCD=amber, General=gray). The kind filter is wired through to the server-side query via the `kind` URL param.
- **Customer Report (`/api/pm-asset-report`)** has bumped cell padding (vertical 90 / horizontal 140 dxa). Per-asset info grid label cells use mid-grey small caps (size 16) alongside bold value cells (size 18) — no shaded label backgrounds.
- **Field Run-Sheet (`/api/maintenance-checklist`)** has three formats with revised semantics (PR #55):
  - `format=simple` (Summary button) → master asset register only, single-page supervisor hand-out
  - `format=standard` (default) → master register page + per-asset detail cards. Supervisor keeps page 1, tech gets the rest. New combined behaviour.
  - `format=detailed` → per-asset detail cards only (no master). For when supervisor already has the master separately.
  - Cover always sits on its own page — every format starts content with a `PageBreak()`. First asset card never glues to the header.
  - Brand strip uses `adjustHex(primaryColour, -0.20)` (auto-darken). SKS primary `#7C77B9` becomes deep purple, EQ sky becomes deep sky, etc. Tenants with explicit `deep_colour` set differently from primary lose that override on this surface only — the rest of the report still honours `deep_colour`.
- **Run-sheet smoke test** at `tests/lib/reports/maintenance-checklist.smoke.test.ts` — produces three sample docx files in `tmp/smoke/` for visual review of layout / colour changes. Run with `npx vitest run tests/lib/reports/maintenance-checklist.smoke.test.ts`.
- **Customer Report smoke tests** — three docx files at `tmp/smoke/pm-asset-report-{summary,standard,detailed}.docx` from `pm-asset-report.smoke.test.ts` (basic per-asset). Plus a fourth file `pm-asset-report-with-linked-tests.docx` from `pm-asset-report-with-tests.smoke.test.ts` which exercises the Test Records section + RCD per-circuit + ACB/NSX deep detail (PRs O + Q).
- **Run-sheet subtle branding (PR L)** — asset card heading already in tenant primary; brand-coloured rule between master register and detail cards (standard format only); footer with company name + ABN + brand-coloured page numbers (run-sheet specific footer; other reports keep grey).
- **Customer Report deep detail (PRs O + Q)** — the bundled Customer Report's "Test Records" section now includes:
  - **RCD Circuit Timing — Per Board** — full per-circuit timing table per linked rcd_test (Section / Cct # / Trip mA / X1 No-Trip 0°/180° / X1 Trip 0°/180° / X5 Fast 0°/180° / Btn / Action). Critical-load circuits highlighted amber. Customer-grade compliance evidence per AS/NZS 3760.
  - **Breaker Test Detail** — per ACB/NSX test: identification grid (Brand / Model / Serial / Rating / Poles / Trip Unit / Performance Level / Fixed-Withdrawable) + readings table (Reading / Value / Unit / Pass-Fail).
  - Both sections gated on per-test `detail` payload presence — PPM-only reports unchanged.
- **TestDetailHeader (PR P)** — shared chrome component (`components/ui/TestDetailHeader.tsx`) used by `/testing/acb/[testId]`, `/testing/nsx/[testId]`, `/testing/rcd/[id]` page.tsx. Standardises breadcrumb + heading + subtitle + back-link block. Workflow content (AcbWorkflow, NsxWorkflow, RcdTestEditor) untouched.
- **testing_checks view dropped (PR M / migration 0086)** — the transition view from PR #28 has been removed. Every code path now reads `maintenance_checks` directly with `.in('kind', […])`.
- **Job-plan-items filter** (`/job-plans/items`) renders the descriptive name regardless of which column the tenant uses (Equinix uses `type`, Jemena uses `name`). Concatenates `code — name · type` deduped.
- **Sticky Create Check button** on `/testing/{acb,nsx}` Create Check views — bar pinned to top so the action stays visible while scrolling through 100-row asset lists.

## Maintenance Checks (unified model — 2026-04-28)

There is **one** "check" concept across the whole app. A `maintenance_checks` row carries a `kind` discriminator that decides what the row is for:

```
maintenance_checks
  ├─ kind = 'maintenance'  ← standard PPM (the original use)
  ├─ kind = 'acb'          ← was testing_checks.check_type='acb'
  ├─ kind = 'nsx'          ← was testing_checks.check_type='nsx'
  ├─ kind = 'rcd'          ← RCD testing
  └─ kind = 'general'      ← legacy general testing
```

Migration 0080 collapsed the parallel `testing_checks` table into `maintenance_checks` with the same UUIDs. Migration 0081 renamed `acb_tests.testing_check_id` and `nsx_tests.testing_check_id` to `check_id` so all three test types use the same column name.

**Linkage:**
```
acb_tests.check_id  → maintenance_checks(id)
nsx_tests.check_id  → maintenance_checks(id)
rcd_tests.check_id  → maintenance_checks(id)
```

A read-only `testing_checks` view backed by `maintenance_checks WHERE kind IN ('acb','nsx','general')` exists during the transition (security_invoker = true so RLS still applies). Old archive helpers continue to read via the view; writes fail loudly. Drop in a follow-up once nothing reads it.

**RLS — who can create checks:** super_admin / admin / supervisor / **technician** (loosened in migration 0080 so technicians can spin up a check on-site). At the app layer this is gated by `canCreateCheck()` from `lib/utils/roles`, NOT `canWrite()` — `canWrite()` deliberately excludes technician so the broader CRUD surface (customers, sites, job plans, etc.) stays supervisor+. Only `createCheckAction` opens the door to technicians.

**Mark Complete propagation:** the shared helper `propagateCheckCompletionIfReady(supabase, checkId)` in `lib/actions/check-completion.ts` flips the parent `maintenance_check` to `complete + completed_at = now()` only when **every** linked test (acb + nsx + rcd) is in its complete state. Wired into the ACB step-3 save, NSX step-3 save, and RCD header save. Idempotent — never clobbers an already-complete parent.

**Items unlock after Complete All (2026-04-28 review).** `updateCheckItemAction` accepts both `in_progress` AND `complete` parent statuses so the tech can bulk-pass via Complete All Assets first, then go back and downgrade specific failures. Audit log captures every flip. `scheduled` and `cancelled` remain blocked.

**"Complete All Assets" button is PPM-only.** The button bulk-marks `check_assets` as completed — only meaningful for kind=maintenance checks where each asset has a fixed task list. Hidden on kind=acb/nsx/rcd checks (test workflows aren't bulk-passable; each test runs through its own 3-step workflow).

## Testing tab navigation (post 2026-04-28)

**Sidebar entry removed.** "Testing" is no longer in the sidebar (PR #38, Royce's review Q4). All test work lives under `/maintenance` now — open a check, see linked tests in the panel, click through. The `/testing/*` routes still resolve for direct URLs and existing deep links from the LinkedTestsPanel, but they're not a top-level destination.

The page-level routes remain:
- `/testing/summary` — combined register, kept for ad-hoc "show me all test-bench checks" queries via direct URL.
- `/testing/acb` — site selector → asset list → in-page 3-step workflow. Toolbar: Import / Export / Breaker Details / Create Check (Report button removed in PR #35 — reports live on `/maintenance/[id]`).
- `/testing/nsx` — same shape. Toolbar: Create Check only.
- `/testing/rcd` — list view. Toolbar: Import xlsx.

**Test-id deep links** — every test type has a dedicated, deep-linkable detail route used by the Linked Tests panel on `/maintenance/[id]`:
- `/testing/acb/[testId]`
- `/testing/nsx/[testId]`
- `/testing/rcd/[id]`

**Sticky Create Check button** — on `/testing/acb` and `/testing/nsx` Create Check views (PR #37), the Create button sits in a sticky bar pinned to the top of the panel so it stays visible while scrolling through 100-row asset lists.

**Legacy URLs `/acb-testing` and `/nsx-testing` 308-redirect** to the canonical `/testing/{acb,nsx}` routes via `next.config.ts`. The route folders only contain `actions.ts` (still imported by the new pages) — old `page.tsx` + List/Form/Detail components were dropped in PR #33.

## ACB Testing Module

3-step workflow for Air Circuit Breakers at `/testing/acb`:
1. **Asset Collection** (Step 1) — breaker identification (brand, type, name/location, serial, performance level N1/H1/H2/H3/L1, protection unit Y/N), trip unit & ratings (model, poles, IN, fixed/withdrawable), protection settings (conditional on protection unit, long time Ir/tr, short time Isd/tsd, instantaneous, earth fault, earth leakage), accessories (motor charge, MX1, XF, MN, MX2 — voltage dropdowns)
2. **Visual & Functional** (Step 2) — 23-item inspection across 5 sections: Visual Inspection (4), Service Operations (3), Functional Tests Chassis (3 incl numeric op counter), Functional Tests Device (11), Auxiliaries (2). Each item OK/Not OK/N/A with comment on failure.
3. **Electrical Testing** (Step 3) — contact resistance R/W/B in µΩ with 30% variance warning, IR closed (7 combos in MΩ), IR open (4 in MΩ), temperature °C, secondary injection check, maintenance completion (greasing, op counter, racking)

Assets filtered by E1.25 job plan (global plan — `name='E1.25'` OR `code='LVACB'`, `site_id` is null). Default tab is Visual & Functional (Step 2).

Excel batch fill: export pre-populated .xlsx per site, fill offline, import back to batch-update all collection data.

Site-level Asset Collection view: expandable cards per CB with all collection fields.

ACB toolbar button order (left to right): Import, Export, Breaker Details, Create Check. "Create Check" opens a manual asset picker — tick the breakers to cover and confirm, which spins up a check container with one ACB test record per selected asset.

## NSX Testing Module

3-step workflow at `/testing/nsx` mirroring ACB. Site-based asset loading filtered by NSX / MCCB job plan (name containing 'NSX' or code `LVNSX`/`MCCB`), falls back to all site assets if no matching plan. Step 1 Asset Collection is a full form (brand, breaker type, serial, current In, trip unit model, poles, fixed/withdrawable/plug_in, protection settings); Step 2 Visual & Functional is the full 23-item inspection across 5 sections matching ACB; Step 3 Electrical Testing covers contact resistance R/W/B, IR closed/open, temperature, secondary injection and maintenance completion — same shape as ACB. State via `step1/2/3_status` columns on `nsx_tests` (migration 0026). NSX toolbar mirrors ACB: Import, Export, Breaker Details, Create Check.

## Testing Summary

`/testing/summary` — combined register of ACB, NSX and General test-bench checks with site / kind / status / date filters, KPI cards and progress bars. **Default landing page** when navigating to `/testing` (redirects automatically). Queries `maintenance_checks` directly filtered by `.in('kind', ['acb','nsx','general'])` (post-merge — was `testing_checks` before 2026-04-28).

## Reports

`/reports` — compliance dashboard with maintenance compliance rate, overdue checks, test pass rate, ACB & NSX workflow progress, defects register summary (status + severity), maintenance compliance by site (top 10) and a 6-month trend chart (tests run vs maintenance checks due).

**Customer Report on `/maintenance/[id]`** — the "Customer Report" button on a maintenance check page calls `/api/pm-asset-report` and produces the customer-facing docx. Since 2026-04-28 (PR #31) it bundles a **Test Records** section with per-asset summary tables for any linked ACB / NSX / RCD tests — one button = one PDF reflecting everything done at the visit. Renders nothing extra when no tests are linked, so existing PPM check reports are unchanged. Cover redesigned in PR #39: tenant logo only (customer logo dropped — it duplicated the customer name in headline type), 56pt headline, more whitespace, italic subtitle line removed.

**Field Run-Sheet on `/maintenance/[id]`** — the "Field Run-Sheet" SplitButton + the explicit "Print Blank for Onsite" button both call `/api/maintenance-checklist` (same endpoint, two entry points so the print-blank intent is obvious). Generator is **kind-aware** since PR #35:
- `kind=maintenance` (PPM): renders one card per `check_asset` with its `maintenance_check_items` as task rows. Long-standing behaviour.
- `kind=acb` or `kind=nsx`: synthesizes one card per linked test with a 5-row task list (breaker brand/model/serial · visual & functional · electrical readings · overall result · notes). Tech writes values in the comment column.
- `kind=rcd`: synthesizes one card per board with one row per circuit (section · circuit no · trip rating · blank X1/X5 timing fields · button-test checkbox).
- Brand strip uses `adjustHex(primaryColour, -0.20)` to auto-darken the tenant's primary (PR #55 — was `tenantDeep` in PR #39). White text reads well, and the brand identity comes through directly: SKS purple `#7C77B9` becomes deep purple on the strip, not the navy `deep_colour` override.

**Per-test-type Reports** were on `/testing/{acb,nsx}` toolbars but were removed in PR #35 — they produced a per-site whole-system PDF that didn't match how reports actually get generated. Reports live on `/maintenance/[id]` now (Customer Report bundles everything; Field Run-Sheet for the printable version).

**Linked Tests panel on `/maintenance/[id]`** — server component `LinkedTestsPanel.tsx` surfaces every acb_test / nsx_test / rcd_test linked to the check. Click-through goes straight to `/testing/{kind}/[testId]`. Renders nothing for plain PPM checks. Sits between Contract Scope and Attachments in the page layout (PR #37 reorder: header → linked tests → attachments → asset table at the bottom).

### Report Settings (`/admin/reports`)
Configurable report template with section toggles (cover, overview, contents, summary, sign-off), company details, header/footer text, sign-off fields, and:
- **Report complexity**: summary / standard / detailed — controls level of detail per asset
- **Logo URL**: custom report logo (falls back to tenant logo)
- **Customer logo toggle**: show/hide customer logo on cover page
- **Site photos toggle**: include site photos on cover page
- DB columns added in migration `0031_report_settings_expansion`

## Job Plans
- Job plans have three scope tiers (shown in the **Scope** column on `/job-plans`):
  - **Site-scoped** — `site_id` set, plan applies to one site only
  - **Customer-scoped** — `customer_id` set + `site_id` null, plan applies to all sites of that customer (e.g. JEMENA-SWB-MAINT). Added migration 0066.
  - **Global** — both null, plan available everywhere in the tenant (the legacy default; all 47 SKS Equinix/Maximo plans are global)
- Columns: code (Job Code), name (Job Plan e.g. E1.25), type (descriptive Name e.g. "Low Voltage Air Circuit Breaker")
- Assets link via `assets.job_plan_id` → `job_plans.id` (1:1; an asset has one primary plan, but maintenance checks can be created against other plans too)
- Toolbar: Items Register, Import, Export, Add Job Plan
- `/job-plans` filters: search, customer, site

## Contract Scope
- `/contract-scope` — tracks included/excluded scope items per customer per FY
- Grouped by customer with included/excluded counts
- Toolbar: Import, Export, Add Scope Item
- Import matches customer/site by name lookup

## Calendar
- `/calendar` — PM calendar with list, calendar (Jan–Dec), and quarterly views
- Show Archived toggle for deactivated entries
- Month ordering: January to December (calendar year)

## Assets Page
- Filterable by customer, site, and job plan (dropdown shows `name - type` e.g. "E1.25 - Low Voltage Air Circuit Breaker")
- Grouped view and table view with site-based grouping
- Customer filter resolves to the customer's sites (joined through `sites.customer_id`); same logic in the page query and in the `get_assets_for_grouping` RPC (migration 0067)

## Maintenance Import (Delta / Maximo)
- `/maintenance/import` — wizard for the monthly Equinix Delta WO export (`.xlsx`)
- Accepts **multiple files in one upload pass** (Phase 1, PR #4) — stage list shows each file with its parse status + remove button; per-file preview/commit happens sequentially with a combined preview view
- **Consolidate toggle** (Phase 2, PR #5) — when ≥2 files for the same site are staged, a single switch merges them into ONE `maintenance_check` (`job_plan_id = NULL`, user-supplied `custom_name`) covering all files' work orders. Each `check_asset` still derives its own `check_items` from its underlying job plan, so per-asset task fidelity is preserved.
- **Locked behaviours:** consolidated frequency = most common across resolved groups (ties → earliest); same WO# across files = hard error before any write; mixed-site upload = consolidate disabled with explanatory warning.
- Two server actions: `commitDeltaImportAction` (single file, unchanged) and `commitConsolidatedDeltaImportAction` (multi-file → 1 check). Wizard branches on the toggle.

## Jemena NSW
Customer onboarded April 2026 under SKS tenant — first non-Equinix customer, first use of the customer-scoped job plan tier.

- **Customer ID:** `556f999a-2023-50e3-ab07-a90056333cfe` · code `JEMENA-NSW`
- **16 sites** all in NSW with `JEM-XXX` codes (e.g. `JEM-NSY` North Sydney, `JEM-GRE` Greystanes). See `supabase/seeds/jemena-onboarding.sql` for full list.
- **47 assets** across 5 types: Distribution Board, Main Switchboard, UPS Distribution Board, ESS Distribution Board, Generator. Each board has `assets.jemena_asset_id` (JM######) populated where Jemena has assigned a JM number, and `assets.expected_rcd_circuits` set for boards (used as Phase 1 RCD import QC). Total expected circuits across all boards: 611.
- **Four customer-scoped job plans:**
  - `JEMENA-SWB-MAINT` (Switchboard PPM, frequency `annual`) — 3 items: DB Maintenance, MSB Maintenance (N/A on sites without MSB), Thermographic FLIR. Technicians use N/A liberally — items don't apply equally to every board. Default plan for the 45 DB/MSB Jemena assets.
  - `JEMENA-RCD-TEST` (RCD PPM, frequency `biannual`) — 2 items: RCD Time Test (annual, May visit only) and RCD Push Button Test (semi-annual, May + Nov). Per AS/NZS 3760. **RCD plan is a secondary overlay** — assets stay pinned to `JEMENA-SWB-MAINT` via `job_plan_id`; the RCD-overlay filter in `previewCheckAssetsAction` / `createCheckAction` swaps the join to `expected_rcd_circuits > 0` when an RCD plan is selected. Detected via `isRcdPlan()` (matches code/name carrying the RCD marker, so any `<TENANT>-RCD-TEST` plan works the same way).
  - `JEMENA-GEN-RUN-START` (Generator PPM, frequency `biannual`) — 8 items split between semi_annual (6-monthly minor: visual, coolant, fuel, batteries, hoses, hours, standby) and annual (major: under-load run for 15 min). The 2 FG Wilson generators (Greystanes + North Sydney) point at this plan. Only those 2 sites have generators per the SOW.
  - `JEMENA-LIGHTING-AUDIT` (Lighting PPM, frequency `quarterly`) — 5 items: Building 1/2/3 walk-throughs (Building 2/3 N/A on smaller sites), defect notes, technician sign-off. Currently only Old Guildford + Unanderra per SOW. Quarterly frequency assumed; confirm with Jemena after first cycle.
- **6-monthly cycle** — May visit covers full SWB-MAINT + RCD time-trip + push-button. November visit is RCD push-button only (one item, runs semi-annual).
- **Calendar:** 16 entries in `pm_calendar` for May 1–15 2026, category `RCD testing`, with SKS Job Code in the description.
- **RCD workflow (delivered 2026-04-27, PRs #12–14, #18, #21–23):**
  - Schema: `rcd_tests` (header per board+visit, FK `check_id` → `maintenance_checks`) + `rcd_test_circuits` (per-circuit timing, with `UNIQUE NULLS NOT DISTINCT (rcd_test_id, section_label, circuit_no)` so multi-section boards like Cardiff DB-1 work).
  - Importer (`/testing/rcd/import`): parses Jemena's 2025 multi-tab xlsx, resolves sites/assets by name (strips "Jemena " prefix), and on commit **finds-or-creates a `maintenance_check`** for the (site, RCD plan, month) bucket and stamps `check_id` on each `rcd_tests`. Frequency = `annual` for May visits, `semi_annual` otherwise. Importer is a **structure-bootstrap tool**, not a historical recorder — values get overwritten by the editor onsite.
  - Onsite editor (`/testing/rcd/[id]`): server component fetches; `RcdTestEditor` (client) toggles between view/edit. Edit mode = inline timing/button/action inputs + editable header (technician/site rep/equipment/notes). **Critical-load circuits stay locked** behind a per-row "Override" toggle — guards UPS/ESS feeders against accidental trip. "Save & mark complete" propagates to the linked `maintenance_check`.
  - Year 2+ flow (no xlsx): `/maintenance` → New Check → pick site + Jemena RCD Testing → form previews show `✨ N circuits will be pre-populated from last visit` per board. On submit, `createCheckAction`'s RCD-overlay block clones the most recent `rcd_test`'s circuit structure (section, circuit_no, rating, jemena id, critical flag) into a fresh draft `rcd_tests` per asset, timing values blank.
  - Validation: `lib/validations/rcd-test.ts` (header + circuit-batch schemas); cross-test ID injection blocked in `updateRcdCircuitsAction` by checking ownership before any mutation.
  - PDF report regeneration via Gotenberg parked short-term — the editor's complete state is the reportable artifact for now.
- **Sites missing data (per SOW review):** site contact name/mobile/after-hrs are null on all 16 sites (TO POPULATE on first visit); some assets missing JM numbers (acquired on-site).
- **Subcontractor exclusions:** UPS PPM owned by Vertiv, generator 6-monthly by Cummins (note in calendar entry descriptions only — no scope flag on assets yet).

## Conventions
- `requireUser()` at the top of every server action — resolves user, tenant, role
- `tsc --noEmit` at 0 errors before any sprint is closed
- **Run `npm run check` before pushing to main.** Equivalent to `tsc --noEmit && next build`. Catches both TypeScript errors and Turbopack bundler rules (e.g. `react-dom/server` imports in app routes). Two prod build failures on 2026-04-26 would have been caught by this — habit it in.
- No credentials hardcoded — `.env.local` only, never committed
- No deployment without explicit Royce instruction in chat
- Working before refactoring
- Auth changes → flag to chat before acting
- All mutations use Next.js server actions: `requireUser()` → role check → Zod validation → Supabase mutation → audit log → `revalidatePath()`
- Zod v4: use `.error.issues[0]` not `.errors[0]`; use `error:` option not `errorMap:`
- Client components use `createClient()` from `lib/supabase/client`; server components/actions use `lib/supabase/server`
- Soft deletes via `is_active` everywhere — no hard deletes (except consumed MFA codes, removed job plan items, **and the `defects` table which uses `status` (open/resolved) + `resolved_at` instead — do not add `is_active` to defects queries, it doesn't exist**)
- All DataTable instances use `onRowClick` — no icon action columns
- Toolbar button order convention: Import (left), Export, then action buttons (right)
- Button labels: "Import" and "Export" — never "Import CSV" or "Export CSV"

@AGENTS.md
