# EQ Solves Service — External Engineering Review

**Date:** 2026-04-16
**Baseline:** v0.1.0 post-reconciliation, migration 0043, main
**Reviewer framing:** Two perspectives — a senior platform/database engineer (Oracle-flavoured: durability, schema, scale, governance) and a senior product/developer-experience engineer (Microsoft-flavoured: DX, ecosystem, lifecycle, ship velocity). Synthesis and next-steps recommendation at the end.
**Goal:** Inform the next planning pass. Not a marketing document — numbers and file references throughout.

---

## 0. Scope and code footprint

Measured at `v0.1.0` head:

| Metric | Count |
|---|---:|
| TypeScript / TSX files (app + lib + components) | 226 |
| Application SLOC (TS/TSX) | 37,051 |
| SQL migrations | 43 |
| Migration SLOC | 4,025 |
| Next.js server-action files (`actions.ts`) | 23 |
| API route handlers | ~20 (`/api/*`) |
| Unit test files | 4 (+ 2 mock/setup) |
| Integration / E2E tests | 0 |
| CI workflows | 3 (`ci.yml`, `data-quality.yml`, `supabase-advisors.yml`) |
| Runtime dependencies | 14 |
| Dev dependencies | 14 |

Stack: Next.js 16, React 19, Supabase (Postgres + Auth + Storage + RLS), Tailwind 4, TypeScript 5, Zod 4, `docx` 9 for reporting, `exceljs` 4 for import/export, `leaflet` for site mapping. Deployed to Netlify.

This is not a toy. Thirty-seven thousand lines of application TypeScript, 4k of SQL, 43 forward-only migrations and a genuinely multi-tenant RLS model put this in the "serious internal SaaS" category that any enterprise IT function at scale would recognise.

---

## 1. Perspective A — Senior Platform / Database Engineer (Oracle lens)

The Oracle instinct is: *show me the schema, show me the transactions, show me what happens when the lights go out.* Under that lens, `eq-solves-service` scores better than most SaaS of its age.

### Strengths

1. **Schema discipline is excellent.** Forty-three sequentially numbered, forward-only migrations with no squash, no rebase, no edits-in-place. Every table has an `is_active` soft-delete flag, `created_at`/`updated_at` timestamps maintained by a single `public.set_updated_at()` trigger, and RLS enabled by default. The `AGENTS.md` file enforces this as a review rule — this is how grown-up shops work.

2. **Tenant isolation is real.** RLS policies use `get_user_tenant_ids()` / `get_user_role(tenant_id)` and are wrapped in `(select …)` (migration 0027) so the planner evaluates them once per query rather than once per row. That is a detail most SaaS at this stage get wrong and lose 10× on query cost when they grow. It is already right here.

3. **Referential hygiene is actively measured.** Migration 0042 added covering indexes to every foreign key, and the data-quality audit (`audits/run.sql`) fails CI when a new FK is added without a covering index. The `structural.fk_covering_index` WARN is a gate against regression, not just documentation.

4. **Data-quality framework is properly DAMA-DMBOK.** Completeness, uniqueness, validity, consistency, and (as of today) timeliness checks, each with an ERROR or WARN level and a rationale in `audits/CHECKS.md`. This is the kind of thing an auditor asks for in year three of a SaaS and is almost never in place. It is in place here in year one.

5. **Replay safety is deliberate.** `lib/actions/idempotency.ts` provides `withIdempotency()`, backed by a unique index on `(tenant_id, mutation_id)` (migration 0028). This is the foundation that makes offline-first (roadmap item 6) tractable rather than fantasy. Oracle would call it "exactly-once semantics at the application layer" and would recognise that someone on this project read the right chapter of the textbook.

6. **Audit logging is a first-class citizen.** The mandatory pattern `requireUser() → role check → Zod → mutation → logAuditEvent() → revalidatePath()` is enforced across all 23 server-action files. `audit_logs` is a real table (migration 0008) with proper indexes. This is what forensic review looks like when it works.

7. **Reconciliation work has been done and is observable.** Migrations 0038–0043 are a sequence of real data-reconciliation operations — customer consolidation, address corrections, asset reassignment, SY1 reconciliation — each with a matching entry in the audits baseline. This is operational maturity. Most SaaS databases reach year three with no such lineage.

### Concerns and gaps

1. **No point-in-time recovery story.** Backups are the Supabase daily snapshot default. The RPO is 24h in the worst case. For a system that stores the primary evidence of electrical compliance work — where a lost day can mean a lost certification submission — 24h RPO is survivable but not comfortable. PITR is a Supabase paid add-on and should be budgeted for before the first paying customer, not after. The backup-restoration drill runbook landed today (`docs/runbooks/supabase-backup-restore.md`) which closes the *process* gap; the *RPO* gap remains.

2. **Trigger-based `updated_at` is the only write-time integrity mechanism.** There are no application-enforced `CHECK` constraints on domain-critical fields (`performance_level`, AU postcode format, AU state codes). These are enforced only at the audit layer, which means bad data can land in the database and only be *detected* on the next audit run, not *prevented* at write time. Oracle instinct is: if the database can enforce it, the database should enforce it. Promoting postcode and state checks from audit to `CHECK` constraints is a half-day of migration work and closes a class of regressions permanently.

3. **No partition strategy and no explicit archival path.** `audit_logs`, `acb_tests`, `nsx_tests`, `test_records` and `check_assets` will grow monotonically. At one Equinix-scale customer running quarterly PM cycles over 5 years you are plausibly in the 10M-row range on `audit_logs` alone. There is no partition-by-date, no `pg_cron` job to move cold rows, no documented archive target. This is not urgent today — but the moment a second large customer comes on, it becomes urgent *retroactively*, and fixing it retroactively is 10× the pain.

4. **The service_role is used for CI queries via personal access token.** The `supabase-advisors.yml` and new `data-quality.yml` workflows authenticate to the Management API with `SUPABASE_ACCESS_TOKEN`, which runs as the project owner — effectively service-role for reads. This is acknowledged in the session log as a known tightening opportunity. An `audit_runner` Postgres role with `SELECT` on `public` and the relevant `pg_catalog` views would close it without any functional impact.

5. **Migration count vs. squash policy.** Forty-three migrations and climbing. At some point around 100 migrations the `supabase db reset` workflow for a fresh branch starts to feel slow. There is no documented squash/consolidation point. Planning for a "baseline migration" at the next major version bump (e.g. v1.0.0 → `0001_baseline.sql` containing the current schema plus `0002_…` onwards for new work) is cheap now and painful later.

6. **No read-replica or read/write separation.** All traffic hits the primary. Today that is fine. For the `/reports` compliance dashboard and the 6-month trend chart, a read replica is the right answer before it becomes a complaint.

7. **The `defects` table lacks a hard closure loop.** Migration 0018 gives status `open|in_progress|resolved|closed` but nothing physically enforces that `resolved_at` is set when status moves to `resolved`, and nothing links a resolving technician's signature. Roadmap item 5 acknowledges this. Until it ships, `defects` is a to-do list rather than a compliance artefact.

### Oracle-lens verdict

**Grade: B+ on schema and governance, B on durability, A– on data quality, C+ on long-horizon scale.** If this project went through an Oracle red-team review, the reviewer's summary would be: "The schema is clean, the RLS is correct, the audit story is above-average. Tighten domain constraints, plan for partitioning and PITR before year two, and document the squash/baseline policy."

---

## 2. Perspective B — Senior Product / Developer-Experience Engineer (Microsoft lens)

The Microsoft instinct is: *show me the inner loop, show me the onboarding, show me the twelve-month roadmap, show me who fixes it at 3am.* Under that lens `eq-solves-service` is impressive for its headcount but has gaps that will bite as soon as it leaves the sole-maintainer phase.

### Strengths

1. **The inner loop is quick.** `npm run dev` + Next.js 16 App Router gives edit-refresh cycles under a second on a modern laptop. Server actions remove the REST round-trip for mutations. The client components use `createClient()` from `lib/supabase/client`; the server actions use `lib/supabase/server`. This is the shape of a 2025/2026 codebase done right.

2. **TypeScript strictness is the gate.** `tsc --noEmit` at zero errors is enforced in CI and taken seriously as a release rule — the session log for 2026-04-16 shows it being re-run after every change. This is the single highest-leverage quality practice on the project.

3. **Conventions are documented and enforced in code review.** `AGENTS.md` and `CLAUDE.md` read like a real engineering handbook — "no `USING (true)` on authenticated-only tables", "wrap `auth.uid()` in `(select …)`", "every table has RLS", "no credentials in the repo", "no deployment without explicit instruction". Anyone joining the project can read five pages and know how to behave.

4. **The design system is modest but coherent.** `components/ui/` is a small in-house library, no shadcn, no copy-pasted garbage from the tailwind-component bazaar. The EQ tokens (`eq-sky`, `eq-deep`, `eq-ice`, `eq-ink`, `eq-grey`) mean a theme swap is one Tailwind-config change away. This is how Microsoft Fluent UI got started: a small, opinionated core with room to grow.

5. **Server-action pattern is the right choice for this app shape.** `requireUser() → role check → Zod validation → Supabase mutation → audit log → revalidatePath()` is mechanical, auditable, and — crucially — the *same* pattern in all 23 action files. A new hire can be productive in a day. A malicious contributor cannot sneak a write past auth because the pattern is so uniform that a deviation stands out on diff.

6. **The feature surface already delivers value.** ACB testing is a full 3-step workflow with 23-item visual checklist, contact-resistance variance warnings, IR closed/open tables, and a defect-raising path that produces `audit_logs` rows. NSX caught up today. Reports generate as DOCX with configurable cover pages, customer logos, and compliance dashboards. Calendar, contract scope, job plans, import/export — the breadth is real.

7. **Runbooks and ops discipline are above weight class.** A solo-maintainer project that ships a backup-restoration drill runbook with quarterly cadence on day one is doing operations better than most 50-engineer SaaS in year three.

### Concerns and gaps

1. **Testing is the single biggest under-investment.** Four unit test files covering utilities (`auth.test.ts`, `csv-parser.test.ts`, `format.test.ts`, `roles.test.ts`). Zero integration tests. Zero E2E. In a 37k-line codebase with 23 server actions and a multi-tenant RLS model, this is the one place where the gap between present state and professional norm is wide. At Microsoft a service of this shape would have, at minimum: server-action integration tests against a throwaway Postgres (testcontainers), a Playwright smoke suite against `npm run dev`, and an RLS "negative path" harness that tries to read another tenant's row and asserts it fails. None of that is here. It is also not expensive to add — a week per layer, and the payback is permanent.

2. **No observability.** No APM (no Sentry, no Datadog, no OpenTelemetry), no structured logs, no request-id propagation. The `/api/health` route exists but it is not clear what it checks. When something breaks in production, the only forensic tools are Supabase logs and `audit_logs`. That is enough to resolve a customer incident but not enough to prevent the next one. OpenTelemetry + a free-tier backend (Axiom, Grafana Cloud, Honeycomb) would be a one-day install and would pay for itself the first time a tenant says "it's slow".

3. **The reporting pipeline is a single point of failure.** Reports are DOCX today via `lib/reports/*.ts`. There is no queue, no retry, no failure metric. A 4,700-asset O&M manual request that times out on a Netlify function will silently disappoint the user and leave no trace. Roadmap item 2 (PDF generation) is the right time to rebuild this as a proper background job with status tracking, idempotency on the job key, and a visible queue in `/admin`.

4. **One dashboard for five roles.** `app/(app)/dashboard/page.tsx` is a single unified view. Technicians, supervisors, admins and super-admins all see the same page. Roadmap item 19 addresses this. Until it ships, the product's "first five seconds" experience is poor for the roles who aren't admin, and that has retention consequences when you start rolling this out to a crew.

5. **The import/export story relies on hand-rolled `exceljs` code.** Every module has its own importer and exporter with its own column-mapping logic. No shared validator, no shared error-report format, no shared "preview the 5 rows that will fail before I commit the import". This is technical debt that will land as a customer-reported bug in year one.

6. **No feature flag system.** Rollout of a new field or a new workflow is an all-or-nothing deploy. For a multi-tenant product with mixed customer maturity, a lightweight flag table (`feature_flags(tenant_id, key, enabled)`) and a `useFeature()` hook would unblock "ship to SKS first, roll out to Equinix later" without branching the codebase.

7. **No offline capability on a tool aimed at field technicians.** This one is acknowledged — roadmap item 6, deferred on purpose because it is a rearchitecture, not a sprint. But from a Microsoft product-manager lens, a testing app that assumes connectivity on a data-centre floor is the most obvious and painful gap in the product. The `withIdempotency()` foundation is already in place; the missing piece is the client-side queue and conflict-resolution UX. Not next, but not later than Sprint 3.

8. **CI runs a lot but doesn't run vitest.** `ci.yml` runs `tsc --noEmit` and `npm audit`. It does not run `npm test`. The data-quality audit runs against production on a schedule but not on a PR that changes business logic. The test gap is real but so is the *run* gap — even the four tests that exist are not gating merges. A one-line addition to `ci.yml` fixes it today.

9. **Documentation is heavy but scattered.** `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `SPEC.md`, `ROADMAP.md`, `SECURITY_PUNCHLIST.html`, `GO_LIVE_ROADMAP.html`, `AI_STRATEGY.md`, `USER_MANUAL_NOTES.md`, `LOCAL_DEV.md`, plus the `docs/` tree. A newcomer needs a map. A one-page `README.md` + `docs/index.md` that names the top five docs and what they are for would onboarded the next engineer in an hour instead of a day.

10. **No Storybook or component catalogue.** For a product with a bespoke design system, this is a missed force-multiplier. Two days of work; permanent payoff every time a new page is built.

### Microsoft-lens verdict

**Grade: A on code discipline and pattern uniformity, B+ on developer experience, C on testing and observability, B– on lifecycle/flagging/rollout.** The instinct is: "This is *far* above normal for a solo or two-person shop. The things it lacks are the things that start to hurt the moment a second engineer joins or the moment a customer files a P1." The top-three investments are: (1) integration + E2E tests, (2) OpenTelemetry + a log backend, (3) a feature-flag table and a background-job queue for reports.

---

## 3. Synthesised assessment — what both lenses agree on

Collapsing the two views:

**What this codebase already does better than most SaaS at its stage:**
- Multi-tenant RLS correctness.
- Forward-only migrations with reconciliation lineage.
- Idempotency foundation for offline.
- Audit logging as a first-class citizen.
- Data-quality framework in CI with DAMA-DMBOK coverage.
- Uniform server-action pattern.
- Documented conventions that are actually enforced.
- Runbook + drill discipline.

**What both reviewers want to see before calling the project "enterprise ready":**
- A tests story that goes beyond utilities (integration + E2E + RLS negative-path).
- Observability / APM / structured logging with request-id propagation.
- A durable reporting pipeline with a background-job queue and status tracking.
- Domain `CHECK` constraints for fields that today live only in the audit layer.
- A partition / archival strategy for the append-heavy tables.
- A feature-flag mechanism for differential rollout.
- A PITR story (Supabase paid add-on) before first paid customer.
- A documented migration-squash / baseline policy.

**What both reviewers think can wait:**
- Advanced RBAC (roadmap item 18) — will be meaningful only after per-persona dashboards ship.
- AI triage / NLP query (items 10 and 22) — value is speculative, cost is high.
- Read replicas — not until a single customer notices.
- Partitioning — not until `audit_logs` approaches 5M rows.

**What neither lens should distract from:**
The product already delivers value. An electrical contractor can run a real ACB test, see a real defects register, generate a real compliance report today. The next investments should protect and extend that, not replace it.

---

## 4. Recommended next steps

In order. This *updates* the existing sprint plan in `docs/roadmap/2026-04-16-next-phase-plan.md` but does not replace it — the roadmap's Sprint 1 (items 11, 1, 2) should ship first because two of those three are already mid-flight in the working tree.

### Immediate (this sprint / Sprint 1 wrap)
1. **Wire `npm test` into `ci.yml`.** One-line change. Makes the existing four tests gate merges. Cost: 10 minutes.
2. **Write integration tests for `app/(app)/acb-testing/actions.ts` and `app/(app)/nsx-testing/actions.ts`.** Use a branch database as the target (roadmap item 12 prerequisite — promote to this sprint). Cover happy path + unauthorised tenant + missing role. Cost: 2 days.
3. **Install OpenTelemetry + a free-tier backend (Axiom or Grafana Cloud).** Propagate a request-id from middleware through server actions into `audit_logs.request_id`. Cost: 1 day.
4. **Promote the postcode / state / performance_level checks from the audit layer to `CHECK` constraints.** One migration. Cost: half a day.

### Sprint 2 (unchanged shape, one addition)
5. **Roadmap items 12 + 13** (branch DB workflow + advisor WARN cleanup) as already planned.
6. **Roadmap items 3 + 4** (reporting enhancements) as already planned.
7. **New: a `report_jobs` table and a minimal background-job queue** for the reporting pipeline, with status `queued | running | complete | failed` and a `/admin/report-jobs` page. This is the skeleton item 2 (PDF generation) will eventually plug into, and it is also the right place to put request-id + OTel spans so reports become debuggable.

### Sprint 3
8. **Roadmap item 5** (work-order closure loop) as planned.
9. **Roadmap item 7** (customer portal) as planned — with the budgeted half-day security review.
10. **Roadmap item 19** (per-persona dashboards).
11. **New: a `feature_flags` table + `useFeature()` hook.** Cost: half a day. Unblocks everything else downstream.

### Sprint 4 and beyond
12. **Roadmap item 6** (offline) — now unblocked by the background-job pattern and feature flags. Still a rearchitecture, budget one-and-a-half sprints.
13. **Partitioning plan for `audit_logs`, `acb_tests`, `nsx_tests` and `test_records`.** Document first, migrate later — but write the document now so the next major migration can land it without a separate design phase.
14. **PITR enablement** — product decision at Royce's level, not an engineering one, but list it here so it is not forgotten.

### Items to cut or downgrade
- **Item 22** (natural-language compliance query) — already cut mid-session today, confirmed by both lenses.
- **Item 10** (AI triage) — defer until feature flags and telemetry exist so the value can be measured rather than hoped for.
- **Item 18** (advanced RBAC) — defer behind item 19 per the existing decision.

---

## 5. What this review is *not* saying

- It is not saying the project is behind schedule. It is ahead of where a project of this size and headcount usually is.
- It is not saying the code needs a rewrite. It needs additive investment, not subtractive.
- It is not saying the roadmap is wrong. The roadmap is largely right; this review tightens the ordering and adds four items the roadmap did not have (tests in CI, OTel, `report_jobs`, `feature_flags`).
- It is not a security audit. A real security audit should run before the customer portal (item 7) ships and is noted as a half-day line item in Sprint 3 of the existing plan.
- It is not a commercial / go-to-market review. Those are separate documents and belong with Royce, not with the engineering review.

---

## 6. Open questions for the next planning session

1. **Is the next customer going to be an internal (SKS) rollout or an external (Equinix direct) pilot?** The answer shapes whether feature flags or portal hardening is more urgent.
2. **What is the commercial model for report generation?** Per-report, per-site, per-seat? The background-job queue and the PDF toolchain decision both hinge on this.
3. **Is there budget for the Supabase paid tier (PITR + branching + higher function limits) in the next quarter?** Several of the gaps above unlock the moment that bill is paid.
4. **Does Royce want to bring on a second engineer in the next six months?** If yes, the testing + observability investments move up; if no, they can stay in this order.

---

**End of review as originally written.** See Section 7 for the decisions that came back from Royce the same day.

---

## 7. Decisions applied (2026-04-16, same day)

Royce answered the four open questions from Section 6. The answers re-shape the recommended next steps materially. Original Sections 1–6 are preserved above as written; this section is the authoritative update.

### Answers

1. **Next rollout is internal (SKS first).** No external customer portal in the immediate horizon.
2. **Reports are per-maintenance-check, issued to the customer.** Unit of work is 1 maintenance check → 1 report → 1 delivery. Not a 4,700-asset O&M manual batch job.
3. **Supabase is already on the paid tier.** PITR, branching, and the higher function-execution limits are available today.
4. **Solo engineer for the foreseeable future.**

### Implications

These answers push the priority list in four directions:

**A — Solo-engineer mode raises the floor on testing and observability.** When there is no second pair of eyes to catch a regression in review, the only thing standing between a bug and a 3am call is CI gates and a log backend. Tests and observability move *up*, not down, even though they look like "team infrastructure" items. The reverse is true: the smaller the team, the higher the leverage of a passing test suite. This is the single most important implication of answer 4 and it reverses the usual intuition.

**B — Internal rollout drops the portal and its security-review cost to the back of the queue.** Roadmap item 7 (customer portal) is now Sprint 5+ rather than Sprint 3. The half-day budgeted security review comes off Sprint 3. No customer-role RLS policies need writing yet.

**C — Feature flags become a "nice to have" rather than a rollout mechanism.** With one tenant and one engineer, differential rollout is not load-bearing. The `feature_flags` table item gets demoted from Sprint 3 to "optional, do it the first time a differential rollout is actually needed". Saves half a day for something higher-value.

**D — The reporting pipeline gets a concrete shape.** A per-check report is a small, bounded unit of work — one maintenance check's worth of DOCX, typically a few pages, not a 4,700-asset catalogue. This *simplifies* the architecture:

- The background-job queue is still the right answer, but the job row is modest and can live in the request path for all but the slowest customers.
- Idempotency key is `maintenance_check_id` + a monotonic `report_revision` column so re-issuing a corrected report is a first-class operation.
- Delivery is "issued to customer", which means *something* needs to own the handoff — an email with the document attached, a signed URL, or a shared folder. This is a product decision that belongs with Royce, but the engineering answer is: store the generated file in the existing `attachments` bucket keyed by `{tenant_id}/reports/{maintenance_check_id}/{revision}.docx`, record it in `audit_logs`, and expose a download URL.
- The paid Supabase tier removes the function-timeout worry for per-check reports. Batch reports (if they ever come back) remain a separate concern.
- PDF vs DOCX: for a customer-facing compliance artefact, PDF is the right format. DOCX stays as the internal template; the pipeline renders DOCX → PDF at delivery time. This is the unlock for roadmap item 2 and it should use `docx` → HTML → headless Chromium (Playwright or `@sparticuz/chromium` on Netlify). `pdf-lib` is still the fallback for certificate-style outputs that don't need layout fidelity, but the main path is DOCX-through-HTML-through-Chromium.

**E — Paid Supabase unlocks three things immediately:**

- **PITR** — turn it on in the dashboard before the next customer-visible deploy. This closes the 24h RPO gap noted in Section 1. Cost: one click, one note in `docs/runbooks/supabase-backup-restore.md` to document the new recovery floor.
- **Branching** — roadmap item 12 is now a 2-hour task, not a 2-day task. Promote to this week.
- **Higher function limits** — report-generation timeouts stop being a concern for per-check reports. Batch reports still need a background path if they come back.

### Revised recommended next steps

Replacing the list in Section 4 with a tighter, solo-engineer-calibrated version:

**This week (while Sprint 1 finishes landing)**
1. **Turn on PITR in Supabase.** 5 minutes. Update the backup-restore runbook with the new RPO.
2. **Wire `npm test` into `ci.yml`.** 10 minutes.
3. **Stand up a Supabase branch workflow** (item 12). With paid branching this is an afternoon, not a sprint. Document the `supabase branches` commands in `docs/runbooks/branch-workflow.md`.
4. **Install OpenTelemetry + Axiom (free tier, generous log volume).** Propagate a request-id through middleware → server actions → `audit_logs.request_id`. One day. This is *not* optional when you are the only one who will be debugging production at 11pm.

**Sprint 2 (revised)**
5. **Integration tests for the two hottest surfaces: ACB and NSX server actions.** Branch DB as target, happy-path + cross-tenant isolation + role-gate negative test. Two days. Aim for ~40% line coverage on `app/(app)/acb-testing/actions.ts` and `app/(app)/nsx-testing/actions.ts`.
6. **Advisor WARN cleanup (item 13).** Run against the new branch DB. One day.
7. **Promote postcode / state / performance_level to `CHECK` constraints.** One migration, half a day.
8. **Report pipeline skeleton:** new table `report_jobs(tenant_id, maintenance_check_id, revision, status, requested_by, generated_at, file_path, mutation_id)` with the usual RLS + audit log. Wrap generation in `withIdempotency()` keyed on `maintenance_check_id + revision`. Half a day.

**Sprint 3 (revised — per-persona dashboards first, reporting second)**
9. **Per-persona dashboards (item 19).** Technician, supervisor, admin landing pages. This is the highest-value UX item for an internal rollout because the technicians will feel it every day. Three days.
10. **DOCX → PDF conversion** at the delivery boundary of the report pipeline. Headless Chromium via `@sparticuz/chromium` on Netlify Functions, or Playwright if the Netlify pro-tier function limits cover it. One day to pick, one day to ship. Roadmap item 2.
11. **Work-order closure loop (item 5).** Thin metadata on `check_assets` rather than a new `work_orders` table — less schema surface, matches the per-check granularity of the report pipeline. Two days.

**Sprint 4 and beyond**
12. **Offline (item 6).** Unblocked by the idempotency + job-queue + request-id story. Still budget a sprint and a half.
13. **Partitioning plan documented** (not executed). Half a day of design, land it in `docs/architecture/partitioning.md`, implement at the next major migration baseline.
14. **Migration squash / baseline policy** documented and scheduled for v1.0.0. Half a day.
15. **Customer portal (item 7)**, *when* the internal rollout is stable and a portal is actually demanded by SKS leadership.

### Explicitly deferred or cut (confirmed)

- **Item 18** (advanced RBAC) — keep deferred.
- **Item 10** (AI triage) — keep deferred.
- **Item 22** (NL compliance query) — cut.
- **Feature flags table** — demoted from Sprint 3 to "build it the first time a differential rollout is needed". Not urgent with one tenant.
- **Read replicas** — not relevant until customer #2.
- **Storybook / component catalogue** — nice to have, solo engineer cannot justify the onboarding-leverage story for a team of one. Defer indefinitely.

### What the solo-engineer constraint actually means

The uncomfortable truth is that the worst-case scenario for this project is not "feature X ships late". It is "Royce is on leave and a bug in production corrupts a maintenance check record the morning before a compliance submission". The investments above are calibrated against that scenario. PITR + tests in CI + OpenTelemetry + idempotent report regeneration are four pieces of insurance against it. Every one of them pays back the first time it prevents a late-night scramble.

The corollary is that *anything* that does not reduce the blast radius of a production incident — Storybook, feature flags, advanced RBAC, AI triage — waits until there is a second engineer or a second customer. Those things are team-leverage plays and the team is one person.

---

**End of review v2.** Superseded priorities are struck through in Section 4 by this Section 7 — when they conflict, Section 7 wins.
