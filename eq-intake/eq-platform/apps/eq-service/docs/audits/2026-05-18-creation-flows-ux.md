# Creation Flows UX Audit — 2026-05-18

> **Status:** delivered for review. No code changes yet. PR slicing in §4 is the
> proposed execution plan once Royce approves scope.

Pre-go-live UX audit of the **creation flows** — both the entity-creation path
an admin walks when onboarding a fresh tenant, and the operational-execution
path a brand-new tech walks the first time they sign in. Conducted via parallel
read-only audits of the two journeys; findings synthesized below with persona
impact annotations.

**Scope:** routes that a brand-new admin or brand-new tech touches in their
first day of using the app.

**Persona baseline:** brand-new tech, day one, on iPad/phone in a switchroom.
This is the worst-case-friction floor. If the app works for them, it works for
the others. Every finding is annotated with secondary persona impact.

**Out of scope:** import flows (Maximo/Jemena), report generation (audited
separately in [`2026-04-26-reports-design-audit.md`](2026-04-26-reports-design-audit.md)),
billing / Stripe (still in Phase B), MFA security policy (flagged but deferred
— needs a separate decision).

---

## 1. TL;DR

The app is structurally sound — the unified `maintenance_checks` model, the
StatusBadge / KindPill / TestDetailHeader cosmetic decisions, the empty-state
CTAs on every list, the ACB workflow's `TriStateButton` — all of this is good
work and should be preserved.

The friction sits in **three crosscutting gaps**:

1. **Permission gating is inconsistent.** The RCD editor blocks technicians via
   `canWrite` even though `canCreateCheck` deliberately includes them — outright
   bug, 5-line fix, blocks Jemena go-live as written.
2. **Smart defaults are absent everywhere.** Every form ignores URL params and
   referrer context. Creating an asset from a site page makes the admin re-pick
   the site. Creating a check requires re-typing dates the system could default.
   The codebase has no shared "prefill from context" primitive.
3. **The tech role inherits the admin UI.** Sidebar shows Records / Insight to
   techs who have no business there; dashboard buries "My Upcoming Works" under
   four tenant-wide KPI tiles; pass/fail tap targets are 28px (vs the ACB
   workflow's 44px-correct pattern); a disabled Complete Check button hides its
   reason in a hover tooltip that doesn't exist on touch.

A separate (smaller) cluster of admin-onboarding bugs makes the SetupChecklist
**lie about progress** — Skip-the-wizard stamps "Company details done" without
real data, a job plan saved with zero items still ticks "done", and dead
`?import=1` query strings don't auto-open the import modal.

Nothing here is architectural. All of it is fixable in 6-8 focused PRs. The P0
slice (tech go-live blockers + onboarding-checklist integrity) is roughly
**350 LOC across 7 files** and could land in a single working session.

---

## 2. Top 10 findings, ranked

Severity scale: **P0** = blocks go-live or is an outright bug. **P1** = first
impression damage; tech or admin can't easily figure things out without help.
**P2** = polish; visible to power users, recoverable on the first try.

### 2.1. (P0) RCD editor blocks technicians

`/testing/rcd/[id]` gates `canEdit={canWrite(role)}` at
[app/(app)/testing/rcd/[id]/page.tsx:101](app/(app)/testing/rcd/[id]/page.tsx:101).
`canWrite` deliberately excludes `technician`. But per
[CLAUDE.md](CLAUDE.md) the whole point of loosening RLS in migration 0080 was
to let technicians do test work onsite. Result: the tech who created the check
opens the deep-linked RCD editor and finds it read-only. This is the
**Jemena-critical path** — RCD timing data is the customer compliance evidence.

- **Persona impact:** all techs doing RCD work. Apprentices and experienced techs
  hit it identically.
- **Fix:** swap to `canCreateCheck(role)`, or introduce
  `canDoTestWork(role)` and use it consistently across all three test routes.
  Audit ACB/NSX equivalents in the same PR — the bug may be wider.
- **Cost:** S.

### 2.2. (P0) Skip-onboarding-wizard falsely ticks "Company details done"

[app/(app)/onboarding/actions.ts:165-167](app/(app)/onboarding/actions.ts:165-167):
`skipOnboardingAction` is a thin wrapper that stamps `tenants.setup_completed_at`.
The SetupChecklist's first row reads `companyConfigured = !!setup_completed_at`
([app/(app)/dashboard/SetupChecklist.tsx:51-59](app/(app)/dashboard/SetupChecklist.tsx:51-59)) —
so clicking Skip produces a progress bar that says "1/7 done" before the admin
has done anything. Erodes trust in the entire guidance system.

- **Persona impact:** every brand-new admin who skips the modal (and many do —
  modals get dismissed reflexively).
- **Fix:** either kill the wizard and keep only the SetupChecklist as the
  onboarding surface, OR make `companyConfigured` reflect real state (e.g.
  tenant has non-default name AND `report_company_name` populated).
- **Cost:** S.

### 2.3. (P0) Job plan can be saved empty; checklist ticks "done" anyway

[app/(app)/job-plans/JobPlanForm.tsx:189](app/(app)/job-plans/JobPlanForm.tsx:189)
hides the Items panel behind `isEdit`. Admin creates a plan, panel closes after
500ms ([JobPlanForm.tsx:65](app/(app)/job-plans/JobPlanForm.tsx:65)), checklist
row ticks done because `hasJobPlan = counts.entities.job_plans > 0`
([SetupChecklist.tsx:47](app/(app)/dashboard/SetupChecklist.tsx:47)). The plan
is empty. The maintenance check the admin creates against this plan spawns
empty per-asset task lists. The tech opens the check on site to find nothing
to do. Silent failure, discovered on site.

- **Persona impact:** every admin doing their first setup. Reach: 100% of new
  tenants.
- **Fix:** gate `hasJobPlan` on `job_plan_items` count > 0, AND surface the
  Items panel in create mode (not edit-only). Pair with §3.4 (starter
  templates) for a kill-shot.
- **Cost:** S.

### 2.4. (P0) No "assigned to me" filter on `/maintenance`

A brand-new tech lands on `/maintenance` and sees every active check in the
tenant. For SKS at Equinix that's 100+ rows. For a Jemena tenant, 16. The page
query at
[app/(app)/maintenance/page.tsx:80-105](app/(app)/maintenance/page.tsx:80-105)
has site / status / kind filters but **no `assigned_to` filter**. The dashboard
has a "mine vs all" toggle ([dashboard/page.tsx:60-66](app/(app)/dashboard/page.tsx:60-66))
but `/maintenance` doesn't.

- **Persona impact:** all techs daily. Brand-new techs hit it hardest — they
  don't know what site they're on yet.
- **Fix:** add `assigned_to=me` filter wired through to the server query.
  Default ON for `technician` role; "Mine / All" toggle visible to all roles.
- **Cost:** S.

### 2.5. (P0) Tap targets below 44px on TaskRow + inline-edits

The ACB workflow's `TriStateButton`
([app/(app)/testing/acb/AcbWorkflow.tsx:116-137](app/(app)/testing/acb/AcbWorkflow.tsx:116-137))
is the gold-standard pattern: `min-h-[44px] px-4 py-2 touch-manipulation
active:scale-95`. Meanwhile the PPM TaskRow pass/fail/na buttons at
[CheckDetailPage.tsx:893-908](app/(app)/maintenance/[id]/CheckDetailPage.tsx:893-908)
use `p-1.5` around a `w-4 h-4` icon — a ~28px tap target. The "Force Complete"
CheckCheck icon ([:799-808](app/(app)/maintenance/[id]/CheckDetailPage.tsx:799-808))
is the same. Inline-edit spans for WO# / Notes / Asset Notes
([:752-797](app/(app)/maintenance/[id]/CheckDetailPage.tsx:752-797)) are click-to-edit
with save-on-blur — accidentally entering edit mode and accidentally committing
half-typed text is one tap each.

- **Persona impact:** all techs on phone, particularly gloved hands. PPM checks
  at Equinix have 5-12 items × N assets of tap-target pain per visit.
- **Fix:** lift the `TriStateButton` to a shared component (or extract the size
  primitive), use it in TaskRow + force-complete + the other places. Replace
  click-to-edit-span with an explicit pencil-icon edit button that opens an
  input with explicit Save / Cancel.
- **Cost:** M.

### 2.6. (P1) Sidebar shows Records / Insight to technicians

[components/ui/Sidebar.tsx](components/ui/Sidebar.tsx) doesn't accept a `role`
prop — only `isAdmin` ([app/(app)/layout.tsx:140-144](app/(app)/layout.tsx:140-144)).
Records is a 5-card hub of Customers / Sites / Contacts / Assets / Job Plans
that a tech has no business touching. Insight is a hub of Reports / Analytics /
Contract Scope / Variations / Commercials — all supervisor concerns.

- **Persona impact:** all techs, but the cognitive-noise tax is highest on
  brand-new techs and apprentices ("what's a Contract Scope and do I need to
  look at it?"). Experienced techs filter automatically.
- **Fix:** pass `role` from layout to Sidebar; hide Records and Insight for
  `technician`. Does not contradict CLAUDE.md's sidebar-grouping decision —
  that decision covers structure for users who do see the items.
- **Cost:** S.

### 2.7. (P1) Tech dashboard buries "My Upcoming Works"

[app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx) renders in this
order for techs: greeting → optional Overdue banner → 4 entity KPI tiles
(Sites/Assets/Job Plans/Customers, [:282-294](app/(app)/dashboard/page.tsx:282-294))
→ Maintenance Overview kanban → optional Defect Summary → optional Site Map →
"My Upcoming Works" at the bottom ([:418-450](app/(app)/dashboard/page.tsx:418-450)).
On a phone the tech scrolls past four screens of tenant-wide chrome before
seeing their actual work.

- **Persona impact:** all techs on mobile, every day. Brand-new techs may never
  scroll far enough to find the list.
- **Fix:** for `technician` role, render "My Upcoming Works" first; demote
  entity KPI tiles to a collapsed "Tenant overview" expander, or hide them
  entirely. Open question: separate `TechDashboard.tsx` component (cleaner
  testing) vs role-aware ordering in the existing dashboard (smaller diff).
- **Cost:** M.

### 2.8. (P1) Forms don't pre-fill from URL params or referrer context

Cross-cutting. Every creation form ignores context the page already has:
- [`SiteForm`](app/(app)/sites/SiteForm.tsx:142-150) defaults `customer_id` from
  the editing record only — no read of `searchParams.get('customer_id')`.
- [`AssetForm`](app/(app)/assets/AssetForm.tsx:160-171) — same for `site_id`.
- [`JobPlanForm`](app/(app)/job-plans/JobPlanForm.tsx:121-134) — same for
  `site_id` / `customer_id`.
- [`CreateCheckForm`](app/(app)/maintenance/CreateCheckForm.tsx:435-437):
  `start_date` and `due_date` are required and empty by default — no "today"
  / "today + 30 days" smart default. Frequency picker doesn't link to the
  selected job plan's actual frequencies (covered separately in §A.8).

The list pages ARE reading `searchParams` for filtering ([`/assets?site_id=...`](app/(app)/assets/page.tsx:17),
[`/sites?customer_id=...`](app/(app)/sites/page.tsx:16)) — the gap is purely in
the form components.

- **Persona impact:** all admins on first setup. Every parent-child link is
  re-typed even when the page knows the answer.
- **Fix:** thread `prefillCustomerId` / `prefillSiteId` props from each list
  page (reading `searchParams`) into each form. Form uses prop as default when
  no editing record is set.
- **Cost:** M (touches 5 forms but each change is small).

### 2.9. (P1) Detail pages lack "Add child entity" CTAs

[`/customers/[id]`](app/(app)/customers/[id]/page.tsx:222-226) shows a Sites
table with no "Add Site" button. [`/sites/[id]`](app/(app)/sites/[id]/page.tsx:217-221)
shows a Recent Assets table with no "Add Asset" button. The natural admin flow
("I just made a customer, now add its sites") is broken — they have to back out
to `/sites`, click Add, manually re-pick the customer they just left.

- **Persona impact:** every admin doing parent-child entity creation.
- **Fix:** add the CTAs. Pair with §2.8 (smart defaults) so the buttons carry
  prefill IDs without re-picking.
- **Cost:** S.

### 2.10. (P1) Disabled "Complete Check" button hides reason in hover tooltip

[CheckDetailPage.tsx:452-455](app/(app)/maintenance/[id]/CheckDetailPage.tsx:452-455):
`<Button disabled={requiredIncomplete > 0} title="N required tasks incomplete">`.
The `title` attribute fires on hover. **Hover doesn't exist on touch.** The
tech taps Complete Check, sees nothing happen, has no idea why.

- **Persona impact:** all techs on mobile, but brand-new techs especially —
  they're the ones who haven't built up the mental model of "ah, this button
  must be disabled because tasks remain".
- **Fix:** render the reason inline below the button (e.g. small amber text
  "3 required tasks remaining"). Or show a toast on disabled-button tap.
  Hover-only affordances should be banned project-wide for actionable controls.
- **Cost:** S.

---

## 3. Design principles

These are the reusable rules emerging from the audit. New features should be
checked against this list before merge. Existing features get migrated when
next touched.

### 3.1. Smart defaults from URL + referrer, always

If the page already knows a value, the form should pre-fill it. Examples:
- `/assets?site_id=X` → "Add Asset" form pre-fills `site_id=X`
- `/customers/X` → "Add Site" CTA pre-fills `customer_id=X`
- A site with exactly one customer association → site form pre-fills customer
- `createCheckAction` selecting one job plan → check frequency defaults to
  that plan's frequency

**Rule:** every form prop interface accepts optional `prefillX` for parent
relationships. List pages thread `searchParams` through to forms. Detail pages
thread their own ID.

### 3.2. 44px minimum tap target, no exceptions

The ACB workflow's `TriStateButton`
([AcbWorkflow.tsx:116-137](app/(app)/testing/acb/AcbWorkflow.tsx:116-137)) is
the reference: `min-h-[44px] px-4 py-2 touch-manipulation active:scale-95`.
Apply everywhere a tech taps. Lift to a shared primitive — `TouchButton`,
maybe co-located with `Button` in `components/ui/`.

**Rule:** any interactive element on a page a tech reaches must meet 44×44px
minimum. Hover-only affordances (`title=`, `:hover` reveal) are banned for
actionable controls — must work on touch.

### 3.3. Setup-state stamps reflect real state, not "skipped"

If a setup step is dismissed without completion, the checklist must not tick
it. Either gate the boolean on real data presence, or make Skip an explicit
"I'll come back to this later" with the row visibly pending.

**Rule:** never let "the user clicked X" stand in for "the data is in place".
The setup state is a function of the data, not of UI events.

### 3.4. Role-shaped UI, not role-stripped UI

Hiding admin features from techs is a start. The bigger win is **changing
defaults** based on role: dashboard ordering, sidebar contents, primary actions
on a check page. Techs are not admins-with-fewer-permissions; they're a
different user with a different task list.

**Rule:** `role` flows from layout into every component that renders
role-sensitive UI. Components branch on role for ordering/visibility decisions,
not just for permission gates.

### 3.5. Validation errors surface inline, on the field

The current pattern returns `error: parsed.error.issues[0].message` as a single
red line at the bottom of the slide panel. The admin has to scroll, guess which
field, fix, resubmit. On a long form (SiteForm has ~14 fields) this is brutal.

**Rule:** server actions return all Zod issues keyed by field path. Forms
render inline per-field errors. Scroll-to-first-error on submit failure.

### 3.6. Sticky submit on long slide-panel forms

iPad portrait + a long slide panel = the admin scrolls past Submit to fill
optional fields and has to scroll back. Sticky footer with Save / Cancel
solves it.

**Rule:** any slide panel taller than ~600px gets a sticky footer with the
primary action.

### 3.7. Field defaults beat field optionality

A required field with no smart default is a friction tax on every form
submission. Prefer:
- "Required field with sensible default" > "required field, empty"
- "Optional field, hidden by default" > "optional field, visible but empty"

`start_date` defaults to today. `due_date` defaults to today + 30 days.
Country defaults to "Australia". Role defaults to `technician` (already done —
good).

---

## 4. Proposed PR slicing

Eight PRs, in two waves. Wave 1 is P0 (~350 LOC, ~7 files). Wave 2 is P1
follow-on (~700 LOC). Wave 3 is P2 polish (~400 LOC). Final two items are
deferred — they need separate decisions before scope locks.

Each PR is independent unless dependency is noted. Sized so that each PR is
reviewable in one sitting.

### Wave 1 — P0 (blocks go-live)

#### PR A — Tech permission + dashboard split + sidebar trim (~180 LOC)
- Fix RCD `canEdit` gate ([rcd/[id]/page.tsx:101](app/(app)/testing/rcd/[id]/page.tsx:101)) —
  also audit ACB/NSX for the same bug.
- Extract `TechDashboard.tsx` (per §5.1) — new component picked at
  [dashboard/page.tsx:148](app/(app)/dashboard/page.tsx:148) when
  `userRole === 'technician'`. Renders "My Upcoming Works" first, "Recently
  Completed" second, optional collapsed "Tenant overview" expander beneath.
- Pass `role` from layout → Sidebar. Hide Records + Insight entirely for
  `technician` (per §5.2). Keep Dashboard / Maintenance / Calendar / Defects /
  Search / Settings.
- Add "Mine / All" toggle on `/maintenance`. Server-side `assigned_to` filter
  wired through. Default ON for `technician`.
- Render disabled-Complete-Check reason inline (drop hover-only `title`).

**Goal: a brand-new tech signs in, sees their work first, completes it without
hitting a permission wall.**

#### PR B — Touch targets pass (~80 LOC)
- Lift the ACB `TriStateButton` size pattern to a shared `TouchButton`
  primitive in `components/ui/`.
- Apply on TaskRow pass/fail/na, force-complete CheckCheck, Sidebar entries.
- Replace inline-edit click-to-swap with explicit pencil-icon + Save/Cancel
  (TaskRow notes, Asset WO# / Notes).
- Add `touch-manipulation` to the SignInForm submit and other primary
  surfaces.

**Goal: gloved hands in plant rooms can hit every button on first try.**

#### PR C — Onboarding-checklist integrity (~120 LOC)
- Skip-the-wizard no longer stamps `setup_completed_at`. Either redefine
  `companyConfigured` to read real tenant fields, or remove the false-tick
  path entirely.
- `hasJobPlan` gates on `job_plan_items` count > 0.
- JobPlanForm shows the Items section in create mode, not edit-only.
- Wire `/assets?import=1` and `/job-plans?import=1` so the import modal
  auto-opens when the param is present.
- Inline role descriptions on InviteUserForm dropdown.

**Goal: the SetupChecklist tells the truth and guides the admin to a
working state, not a "ticked but broken" state.**

### Wave 2 — P1 (first-impression cleanup)

#### PR D — Smart-defaults framework (~200 LOC)
- Define the prop convention: every creation form accepts optional
  `prefillX` for its parent relationships.
- Wire SiteForm, AssetForm, JobPlanForm, CreateCheckForm to read their
  prefill props.
- List pages read `searchParams` and pass through.
- CreateCheckForm: default `start_date` = today, `due_date` = today + 30
  days. Frequency defaults to selected job plan's frequency when exactly one
  plan is picked.

**Depends on:** nothing. Sets the framework that PRs E and F build on.

#### PR E — Detail-page "Add child" CTAs (~60 LOC)
- "Add Site" on `/customers/[id]` → opens SiteForm with `customer_id`
  pre-filled.
- "Add Asset" on `/sites/[id]` → opens AssetForm with `site_id` pre-filled.
- Add Asset Type as a `<datalist>` autocomplete on AssetForm — source from
  the same RPC used by the list filter.

**Depends on:** PR D for prefill plumbing.

#### PR F — Maintenance Plan starter templates + UI rename (~280 LOC)
- Rename UI label from "Job Plan" to "Maintenance Plan" across all surfaces
  (per §5.3). Schema stays `job_plans` — no migration. Touch: sidebar
  labels, page titles, form labels, dropdown labels, empty-state copy,
  microcopy. Grep is the friend here.
- 3-5 starter templates seeded on tenant create or available via "Use
  starter templates" CTA on the SetupChecklist row. Suggested set:
  annual switchboard PPM, monthly visual inspection, RCD biannual time-trip,
  generator semi-annual, light-fixture quarterly walk-through.
- Microcopy panel on the renamed Plan form explaining what a plan is.

**Depends on:** PR C for items-in-create.

### Wave 3 — P2 (polish)

#### PR G — Field execution polish (~150 LOC)
- Promote "Print Blank for Onsite" to a prominent CTA above the asset table
  when the check is `scheduled` or `in_progress`.
- Add kind-aware subtitle on `/maintenance/[id]` ("PPM check — work through
  the asset table" vs "ACB test — open each linked test below").
- Auto-progress: first pass/fail tap on a `scheduled` check calls
  `startCheckAction` and flips to `in_progress`.
- For `technician` role on a complete check: demote "Customer Report",
  promote "Back to my checks" / "Next assigned check".

#### PR H — Validation surface (~180 LOC)
- Server actions return Zod issues keyed by `path[0]`. Forms render
  per-field inline errors.
- Sticky submit footer on SlidePanel forms taller than ~600px.
- Scroll-to-first-error on submit.
- Collapse "Logo Override" and "Geocode Lat/Lng" advanced sections by
  default.

#### PR I — Tech first-login welcome (~100 LOC, P2)
- One dismissible card on first dashboard render for `technician` role:
  "Here's your first check. Tap to open."
- State stored as `tenant_members.tech_onboarded_at`.

#### PR J — MFA grace period (~150 LOC, P2, security-reviewed)
- Add an N-day grace period after first signin (per §5.4). Banner on
  every page during grace window. Hard-gate to `/auth/enroll-mfa` after
  N days. Applies to all roles.
- Touches: migration (`profiles.mfa_grace_started_at` or
  `tenant_members.mfa_grace_started_at` — TBD during scoping),
  [proxy.ts:70-79](proxy.ts:70-79) middleware, new banner component on
  the layout, RLS review.
- **Security-policy PR** — requires explicit Royce review before merge per
  [AGENTS.md](AGENTS.md) auth-change rule. N = 14 days (per §5.4).

### Deferred — post-go-live

#### Offline-safe save queue (post-go-live)
- Inline-edit handlers ([CheckDetailPage.tsx:310-368](app/(app)/maintenance/[id]/CheckDetailPage.tsx:310-368))
  lose data on network drop. Fix is optimistic local state + IndexedDB
  retry queue, leveraging `withIdempotency()` from
  [AGENTS.md](AGENTS.md). Architectural lift; flag for v1.1.

---

## 5. Decisions (resolved 2026-05-18)

The four open questions from the initial draft have been answered. Recorded
here so execution PRs reference a single source of truth.

### 5.1. Dashboard for techs — **separate component**

**Decision:** extract `TechDashboard.tsx`, picked at
[dashboard/page.tsx:148](app/(app)/dashboard/page.tsx:148) when
`userRole === 'technician'`. Pays the seam cost now so tech UX can evolve
independently. Reflected in PR A scope.

### 5.2. Sidebar trim for techs — **hide entirely**

**Decision:** for `technician` role, hide Records and Insight nav sections
entirely. Simpler, less noisy. Promoted-to-supervisor cases get the items
back when the role changes. Reflected in PR A scope.

### 5.3. UI label rename — **"Maintenance Plan"**

**Decision:** rename UI label from "Job Plan" to "Maintenance Plan" across
all surfaces. Schema stays `job_plans` (no migration). One-time
disorientation for current users (Royce, SKS team) accepted in exchange for
new-admin clarity. Reflected in PR F scope.

### 5.4. MFA for technicians — **N-day grace period for all roles**

**Decision:** add an N-day grace period after first signin during which
the user can defer MFA enrolment. Banner reminder shown on every page
during the grace window; hard-gate to `/auth/enroll-mfa` after N days.
Applies to **all roles**, not just technicians (single global policy).

**N = 14 days** (resolved 2026-05-18). Long enough for a new tech to do
real work and get help; short enough to enforce real adoption inside a
single payroll cycle.

**Note (AGENTS.md security invariant):** any change to the MFA / auth flow
requires explicit chat approval before merge. This decision is the
heads-up; the implementation PR (designated **PR J** in the slicing) is
its own separate PR, not bundled with UI work. New schema column likely
needed (`profiles.mfa_grace_started_at` or similar) — migration + RLS
review required.

---

## Appendix A — Admin cold-start audit (verbatim findings)

> Read-only walkthrough of the path from "fresh tenant signup" to "first
> maintenance check assigned to a tech". Persona: non-technical business
> owner.

### A.1. The two onboarding surfaces overlap, conflict, and "Skip" silently completes setup

A new admin sees both the modal `OnboardingWizard` (Company → First Site →
Ready) AND the dashboard `SetupChecklist`. Clicking the wizard's "Skip setup
for now" calls `skipOnboardingAction` which is a thin wrapper over
`completeOnboardingAction` — it stamps `tenants.setup_completed_at`, so the
SetupChecklist's first row ("Company details") immediately ticks done
without the admin entering anything.

**Where:** [app/(app)/layout.tsx:153-155](app/(app)/layout.tsx:153-155),
[app/(app)/onboarding/actions.ts:165-167](app/(app)/onboarding/actions.ts:165-167),
[app/(app)/dashboard/SetupChecklist.tsx:51-59](app/(app)/dashboard/SetupChecklist.tsx:51-59).

### A.2. "Job plan" is jargon, and the SetupChecklist requires it before scheduling

Step 5 of the checklist ("Set up a job plan") locks step 6 ("Schedule a
maintenance check"). The description on the row is "Job plans define the
tasks performed at each visit (e.g. annual switchboard PPM, RCD time-trip)"
but that's the only place the concept is explained. There are no starter
templates, no example library, no copy-from-tenant action — admin clicks
"Create plan" and lands on an empty `/job-plans` form with fields Name / Job
Code / Type / Site / Description / Frequency and no guidance about what to
type.

**Where:** [SetupChecklist.tsx:86-93](app/(app)/dashboard/SetupChecklist.tsx:86-93),
[JobPlanForm.tsx:115-160](app/(app)/job-plans/JobPlanForm.tsx:115-160).

### A.3. Job plans can be saved with zero items, and the checklist still ticks "done"

`JobPlanForm` only renders the Items section AFTER `isEdit` is true. Admin
creates the plan, the form closes (`setTimeout(() => onClose(), 500)` at
[JobPlanForm.tsx:65](app/(app)/job-plans/JobPlanForm.tsx:65)), back on the
list. The SetupChecklist's `hasJobPlan = counts.entities.job_plans > 0`
([SetupChecklist.tsx:47](app/(app)/dashboard/SetupChecklist.tsx:47)) ticks
done — but the plan has zero tasks, so the maintenance check spawns empty
per-asset task lists.

### A.4. Detail pages have no "Add X" CTAs — admin must back out and use the list page

`/customers/[id]` shows Sites table with no Add Site button.
`/sites/[id]` shows Recent Assets table with no Add Asset button. Natural
mental flow broken — admin navigates to /sites, clicks Add, then manually
picks the customer they just left.

**Where:** [customers/[id]/page.tsx:222-226](app/(app)/customers/[id]/page.tsx:222-226),
[sites/[id]/page.tsx:217-221](app/(app)/sites/[id]/page.tsx:217-221).

### A.5. Forms never pre-fill from URL params or referrer context

`SiteForm` accepts a `customers` prop but `customer_id` defaults only to
`site?.customer_id ?? ''` — no read of `useSearchParams().get('customer_id')`,
so a link from a customer page like `/sites?customer_id=…` only filters the
list, not the new-site form. Same pattern in `AssetForm` (`site_id` only
defaults from the editing asset). `JobPlanForm` same for
`site_id` / `customer_id`.

**Where:** [SiteForm.tsx:142-150](app/(app)/sites/SiteForm.tsx:142-150),
[AssetForm.tsx:160-171](app/(app)/assets/AssetForm.tsx:160-171),
[JobPlanForm.tsx:121-134](app/(app)/job-plans/JobPlanForm.tsx:121-134).

### A.6. Setup-checklist "Import xlsx" links are dead query strings

`SetupChecklist` renders secondary CTAs `Import xlsx` linking to
`/assets?import=1` and `/job-plans?import=1`. Neither page reads `import=1`
and auto-opens the import modal. Admin lands on the list with a useless
query string and has to find the Import button manually.

**Where:** [SetupChecklist.tsx:83, 92](app/(app)/dashboard/SetupChecklist.tsx:83),
[assets/page.tsx:13-23](app/(app)/assets/page.tsx:13-23),
[AssetList.tsx:53](app/(app)/assets/AssetList.tsx:53).

### A.7. Invite form has no role guidance for a brand-new admin

`InviteUserForm` defaults the role select to `technician` (good) but the
dropdown lists `super_admin`, `admin`, `supervisor`, `technician`,
`read_only` with no helper text. A new business owner doesn't know what
"supervisor" can do vs "technician".

**Where:** [InviteUserForm.tsx:33-47](app/(app)/admin/users/InviteUserForm.tsx:33-47).

### A.8. CreateCheckForm asks for "frequency" with no link to job plan frequencies

The create-check slide panel forces the admin to pick from 9 frequencies
(monthly, quarterly, semi_annual, annual, 2yr, 3yr, 5yr, 8yr, 10yr) before
they can even preview assets. The frequency drives which `freq_*` columns on
`job_plan_items` get selected — but the admin doesn't see this connection
and the form doesn't validate that any item in the picked plan has that
frequency flag set. So a plan with only `freq_annual` items gets paired with
frequency=quarterly and the preview will be empty / wrong.

**Where:** [CreateCheckForm.tsx:14-24, 220-235](app/(app)/maintenance/CreateCheckForm.tsx:14-24),
[maintenance/actions.ts:36-49](app/(app)/maintenance/actions.ts:36-49).

### A.9. Wizard vs SetupChecklist narrative inconsistency

`OnboardingWizard` step 2 creates a Site optionally with a Customer
(auto-creates the customer by name lookup in
[createFirstSiteAction:96-115](app/(app)/onboarding/actions.ts:96-115)). After
the wizard, the SetupChecklist insists step 2 is "Add your first customer"
then step 3 "Add a site" — but if the wizard already made both, both rows
tick. If the wizard skipped the site step, the checklist's step 3 says
"locked until customer exists" even though the natural app flow is
site-first when you have only one customer.

### A.10. Maintenance check creation: two-step Preview-then-Create with surprise fields after the action

The slide panel has the admin pick site + frequency + (optional) job plan,
click "Preview Assets," then keep scrolling to find Custom Name, Start Date,
Due Date (required), Owner, Maximo WO #, Maximo PM #, Notes. The Create
button is disabled until siteId + frequency are set — but it never disables
on missing start/due date even though they're `required`. So the form fails
on submit with "Invalid input" rather than gating earlier.

**Where:** [CreateCheckForm.tsx:430-477](app/(app)/maintenance/CreateCheckForm.tsx:430-477).

### A.11. Validation is submit-time only, error UX is one tiny red line

Every server action returns `{ success: false, error: parsed.error.issues[0].message }` —
only the first issue, only after submit, rendered as a single
`<p className="text-sm text-red-500">` at the bottom of the slide panel
([CustomerForm.tsx:292](app/(app)/customers/CustomerForm.tsx:292),
[SiteForm.tsx:274](app/(app)/sites/SiteForm.tsx:274),
[AssetForm.tsx:201](app/(app)/assets/AssetForm.tsx:201),
[JobPlanForm.tsx:161](app/(app)/job-plans/JobPlanForm.tsx:161)). No inline
field-level error markers, no aria-invalid, no field-level focus on failure.

### A.12. Mobile / iPad: slide-panel forms are dense; submit can blow off-screen

`SiteForm` is a long slide panel — name, code, customer, address, 2-col
city/state, 2-col postcode/country, geocode button + message, 2-col
lat/lng, photo, then a logo-override section with two more MediaPickers
and a hidden file input fallback. On iPad portrait the slide panel becomes
a near-full-width modal but with no sticky submit bar — admin scrolls past
the Submit button to fill the logo, scrolls back up to submit. Same pattern
in `CustomerForm`, `JobPlanForm`.

### A.13. What works well on the admin side — don't break

- **SetupChecklist visual design** — the locked / up-next / done states with
  the green check / sky-blue dot / grey-lock pattern is clear. Progress bar
  + "Up next" pill + footer hint are well-judged.
- **OnboardingWizard customer auto-create** — typing a customer name in the
  wizard's site step looks it up case-insensitively and creates if missing.
  Right level of magic for first-run. Generalise this to the regular
  `createSiteAction`.
- **InviteUserForm idempotency** — re-inviting an existing user re-attaches
  them to the current tenant rather than erroring with "user exists".
  Friendly error translation via `friendlyAuthError` is also good.
- **No-tenant fallback screen** — orphaned users see a clean "No tenant
  assigned" page with Sign-out, not an empty app shell. Preserves the
  explicit-fix path via `repairUserTenantAction`.
- **Empty-state CTAs on every list page** — Customers / Sites / Assets / Job
  Plans / Maintenance all render "Create your first X" inside the empty
  card.
- **Geocode-from-address button** on SiteForm
  ([SiteForm.tsx:191-203](app/(app)/sites/SiteForm.tsx:191-203)) solves the
  lat/lng input chore by reading the address fields and populating numerics.
  Good example of a smart default that lifts a chore off the admin.
- **Multi-plan Job Plan filter + Preview Assets on CreateCheckForm**
  ([CreateCheckForm.tsx:277-402](app/(app)/maintenance/CreateCheckForm.tsx:277-402)) —
  once the admin understands the model, the preview block with task counts
  and RCD-circuit-count hints is excellent decision support.
- **RCD-overlay messaging on the preview** — "N circuits will be
  pre-populated from last visit" is a beautifully on-point microcopy moment.

---

## Appendix B — Tech cold-start audit (verbatim findings)

> Read-only walkthrough of the path from "tech signs in for the first time"
> to "tech completes a check or test". Persona: brand-new tech, day one, on
> iPad/phone in a switchroom.

### B.1. MFA enrolment is mandatory and blocks the first task

Every brand-new tech is force-redirected to `/auth/enroll-mfa` on first
sign-in (AAL1 with no factor) and must install an authenticator app + scan
a QR + save recovery codes before they can see the dashboard.

**Where:** [proxy.ts:70-79](proxy.ts:70-79),
[EnrollMfaFlow.tsx:40-69](app/(auth)/auth/enroll-mfa/EnrollMfaFlow.tsx:40-69).

### B.2. No "assigned to me" filter on `/maintenance`

A brand-new tech lands on `/maintenance` (via the Maintenance sidebar entry)
and sees every active check in the tenant. The page query has site / status /
kind filters but no `assigned_to=me`. The default `sites` view groups by
site, the table view sorts by due date, but neither narrows to the current
user.

**Where:** [maintenance/page.tsx:80-105](app/(app)/maintenance/page.tsx:80-105),
[MaintenanceList.tsx:146-153](app/(app)/maintenance/MaintenanceList.tsx:146-153).

### B.3. Dashboard's "My Upcoming Works" is buried under entity KPI tiles

The tech's actual first-action surface is the second-to-last card on the
dashboard, after: hero greeting, Overdue banner, 4 entity KPI tiles, Maintenance
Overview kanban, Defect Summary, Site Map. On a phone the tech scrolls past
four screens of irrelevant tenant-wide chrome.

**Where:** [dashboard/page.tsx:282-294](app/(app)/dashboard/page.tsx:282-294),
[:418-450](app/(app)/dashboard/page.tsx:418-450).

### B.4. Sidebar shows admin/supervisor surfaces the tech can't usefully use

`Sidebar.tsx` shows Dashboard, Records, Maintenance, Calendar, Defects,
Insight, Search, Settings to ALL roles. Records leads to a 5-card hub
(Customers, Sites, Contacts, Assets, Job Plans) where a tech has no
business. Insight leads to Reports/Analytics/Contract Scope. No `role` prop
is even passed to `Sidebar`.

**Where:** [Sidebar.tsx:75-93](components/ui/Sidebar.tsx:75-93),
[layout.tsx:140-144](app/(app)/layout.tsx:140-144).

### B.5. Settings hides assignment / notification controls techs need

Notification preferences live in `/settings`, which is in the sidebar but
unlabelled. A tech who isn't getting email reminders has nowhere obvious to
fix it.

**Where:** [settings/page.tsx:69-71](app/(app)/settings/page.tsx:69-71).

### B.6. Setup-state checklist hijacks the dashboard for admins, no equivalent for techs

For admins in an un-setup tenant, the dashboard is replaced with
`SetupChecklist`. Techs get the regular dashboard with no first-run
guidance. Their FIRST screen is the same as their 100th.

**Where:** [dashboard/page.tsx:146-157](app/(app)/dashboard/page.tsx:146-157).

### B.7. Asset table inline-editing pattern is fat-finger hostile on mobile

The asset table on `/maintenance/[id]` uses `onClick` to swap a span into an
input field for WO# and Notes, then `onBlur` saves. On a phone the tap
target is the whole `<td>` (24px tall, `py-2.5`), and the saved-on-blur
model means tapping anywhere else accidentally commits whatever's typed.
No Cancel/Save/Discard affordance.

**Where:** [CheckDetailPage.tsx:730-797](app/(app)/maintenance/[id]/CheckDetailPage.tsx:730-797),
[:887-940](app/(app)/maintenance/[id]/CheckDetailPage.tsx:887-940).

### B.8. Pass/Fail/N/A icons on TaskRow are too small for the field

Inside the expanded asset row, the Pass/Fail/N/A buttons are `<button
className="p-1.5">` wrapping a `w-4 h-4` icon — total tap area ~28px.
Compare to the ACB workflow which uses `min-h-[44px] px-4 py-2` for the
same decision.

**Where:** [CheckDetailPage.tsx:893-908](app/(app)/maintenance/[id]/CheckDetailPage.tsx:893-908).

### B.9. The "Complete Check" button is disabled but the reason is in a `title` tooltip

`<Button disabled={requiredIncomplete > 0} title="N required tasks
incomplete">Complete Check</Button>` — `title` fires on hover, doesn't exist
on touch.

**Where:** [CheckDetailPage.tsx:452-455](app/(app)/maintenance/[id]/CheckDetailPage.tsx:452-455).

### B.10. `/testing/rcd/[id]` blocks technicians from editing

The RCD editor gates with `canEdit={canWrite(role)}`. `canWrite` excludes
`technician`. Per CLAUDE.md, technicians explicitly should be able to do
test work onsite — this is a Jemena-critical path bug.

**Where:** [testing/rcd/[id]/page.tsx:101-103](app/(app)/testing/rcd/[id]/page.tsx:101-103).

### B.11. No "Start Check" auto-progression

A `scheduled` check requires the tech to tap "Start Check" first; only then
do the task rows become editable. Brand-new tech tapping pass/fail on a
scheduled check sees no response.

**Where:** [CheckDetailPage.tsx:197-202](app/(app)/maintenance/[id]/CheckDetailPage.tsx:197-202),
[:436-438](app/(app)/maintenance/[id]/CheckDetailPage.tsx:436-438),
[:318](app/(app)/maintenance/[id]/CheckDetailPage.tsx:318).

### B.12. Field run-sheet print path lives under a SplitButton, not labelled "Print"

The printable run-sheet is reached via `<PrintReportSplit>` and
`<PrintBlankButton>` on `CheckDetailPage.tsx:496-498`. Both labels include
"Print" but they're at the END of the action-button row, after Customer
Report, Send Report, Re-open, Delete. The "Print Blank for Onsite" intent
is buried.

### B.13. Network drop during inline-edit saves loses data silently

`handleAssetNote`, `handleAssetWO`, `handleItemResult`, `handleItemNotes`
all set `setError(...)` on failure but don't restore the previous value or
queue a retry. On flaky plant-room wifi, the tech could type a long note,
blur to commit, see a red banner, and have to re-type. Flagged for v1.1.

**Where:** [CheckDetailPage.tsx:310-368](app/(app)/maintenance/[id]/CheckDetailPage.tsx:310-368).

### B.14. "Customer Report" is the dominant action on a completed check

Once a check is `complete`, the most prominent button is "Customer Report"
(sky background). The tech's mental model after completing is "I'm done,
what next?" — but the UI hands them a customer-facing PDF download, which
the tech almost never wants.

**Where:** [CheckDetailPage.tsx:463-468](app/(app)/maintenance/[id]/CheckDetailPage.tsx:463-468).

### B.15. KindPill colour-coding (PPM / ACB / NSX / RCD) is invisible cognitive load for techs

The tech needs to internalise "Type" means "what kind of test workflow" —
PPM uses the asset table, ACB/NSX/RCD use Linked Tests. There's no in-app
explanation. The page-level accent strip on `/maintenance/[id]` is
status-driven, not kind-driven, so the tech can't pre-empt which UI they'll
get.

**Where:** [MaintenanceList.tsx:84-87](app/(app)/maintenance/MaintenanceList.tsx:84-87),
[maintenance/[id]/page.tsx:80-89](app/(app)/maintenance/[id]/page.tsx:80-89).

### B.16. What works well on the tech side — don't break

- **The chooser landing on `/auth/signin`** — two clear tiles (Sign in vs
  Demo), sample report PDFs prominent.
- **The 'mine' default view on the dashboard** for non-admin roles
  ([dashboard/page.tsx:60-66](app/(app)/dashboard/page.tsx:60-66)).
- **The Overdue alert banner** — big amber tile, click anywhere, goes to
  `/maintenance?status=overdue`.
- **The status-driven hairline accent on `/maintenance/[id]`** — subtle but
  informative.
- **The ACB workflow's `TriStateButton`**
  ([AcbWorkflow.tsx:108-138](app/(app)/testing/acb/AcbWorkflow.tsx:108-138)) —
  44px min, `touch-manipulation`, `active:scale-95`. Gold-standard pattern.
  Extend everywhere.
- **The LinkedTestsPanel between ContractScope and Attachments**
  ([maintenance/[id]/page.tsx:114-117](app/(app)/maintenance/[id]/page.tsx:114-117)) —
  surfaces all the test workflow entry-points inline.
- **The "No tenant assigned" error screen**
  ([layout.tsx:48-73](app/(app)/layout.tsx:48-73)) — clear, actionable,
  doesn't dump the user into a broken UI.
- **The CollapsibleSection thresholds** — asset table collapses if > 10
  assets, attachments if > 5, linked tests if > 5. Right instinct.
- **`isAssigned` widening of `canAct` on the check page**
  ([CheckDetailPage.tsx:118](app/(app)/maintenance/[id]/CheckDetailPage.tsx:118),
  [:125](app/(app)/maintenance/[id]/CheckDetailPage.tsx:125)) — even though
  `canWrite` excludes technician, the page passes `isAssigned` and uses
  `canAct = canWriteRole || isAssigned` so the assigned tech can act on a
  check they don't own role-wise. **Replicate this in
  `/testing/rcd/[id]`.**
- **The Field Run-Sheet's kind-aware generator** — PPM/ACB/NSX/RCD each
  produce a sensible printed format.

---

## Audit metadata

- **Date:** 2026-05-18
- **Auditors:** two parallel read-only Agent passes (admin + tech journeys),
  synthesized.
- **Method:** code-read only; no browser session. Persona-specific browser
  verification deferred to PR-time validation.
- **Files referenced:** see file:line links throughout.
- **Status:** delivered for Royce review. No code changes yet.
