# EQ Solves Service — Next Phase Build Plan

**Date:** 2026-04-16
**Baseline:** v0.1.0 post-reconciliation, migration 0043
**Author:** Planning pass (Royce + Claude)
**Status:** DRAFT — awaiting approval before any code is written

---

## Section 1 — Verification Pass

Snapshot corrections and confirmations against the current codebase. Every claim cites a file.

### Corrections to the snapshot

1. **Reports are DOCX, not PDF.** There is no PDF library in `package.json` at all. The existing report pipeline uses `docx@9.6.1` via `lib/reports/acb-report.ts`, `nsx-report.ts`, `pm-check-report.ts`, `pm-asset-report.ts`, exposed through `/api/acb-report`, `/api/nsx-report`, `/api/pm-report`, `/api/pm-asset-report`, `/api/bulk-report`, `/api/maintenance-checklist`. This reframes items 2–4 of the shortlist — PDF generation is a **new capability**, not an enhancement. Cheapest path is likely headless rendering (Playwright or a Netlify function) or `pdf-lib` for certificate-style output.

2. **The audit framework already exists.** `/audits/run.sql` (10,351 bytes) holds ~40+ DAMA-DMBOK checks across completeness, uniqueness, validity, consistency, RLS, FK covering indexes, and soft-delete hygiene. `/audits/CHECKS.md` documents them and `/audits/baseline-2026-04-16.md` is the current snapshot. **It is NOT wired into CI.** Item 11 shrinks from "build a DQ framework" to "wire the existing framework into a GitHub Action". Effort drops materially.

3. **Supabase advisors are already gated in CI.** `.github/workflows/supabase-advisors.yml` runs security + performance advisors on PR (when migrations change), daily at 08:15 UTC, and on manual dispatch — and fails on ERROR-level findings. Item 13 is therefore advisor WARN **cleanup**, not advisor wiring.

4. **NSX scaffold state confirmed verbatim.** `app/(app)/testing/nsx/NsxWorkflow.tsx:208–227`: Step 2 reads "Framework placeholder — this step will mirror the ACB visual & functional inspection (23 items across 5 sections). Populate the check list in a follow-up iteration." Step 3 similarly placeholder. `test.step2_status` and `test.step3_status` are rendered but only enumerate `'pending' | 'in_progress' | 'complete'`. ACB by contrast is complete in `AcbWorkflow.tsx`.

5. **`withIdempotency` is real and in production.** `lib/actions/idempotency.ts:41–62`:
   ```ts
   export async function withIdempotency<T>(
     mutationId: string | undefined | null,
     fn: () => Promise<ActionResult<T>>
   ): Promise<ActionResult<T>>
   ```
   Already used by `app/(app)/acb-testing/actions.ts` and `nsx-testing/actions.ts`. Item 6 (offline) has a working server-side anchor.

6. **Defects have no work-order model.** `migrations/0018_defects.sql` gives severity `low|medium|high|critical` and status `open|in_progress|resolved|closed` with `raised_by`, `assigned_to`, `resolved_by`, `resolved_at`, `resolution_notes`. Migration 0014 added `check_assets.work_order_number` as a **free-text field**, no FK, no WO table. Item 5 (closure loop) needs a new `work_orders` table or a deliberate decision to stay with the free-text field.

7. **No customer role exists.** `lib/types/index.ts` and `lib/utils/roles.ts`: `Role = 'super_admin' | 'admin' | 'supervisor' | 'technician' | 'read_only'`. `WRITE_ROLES = ['super_admin','admin','supervisor']`. Item 7 (customer portal) requires a new role plus corresponding RLS policies on every customer-visible table.

8. **No compliance-standards schema.** AS/NZS 3760 appears as inline strings in `pm-calendar/actions.ts` demo data only. No reference table, no mapping from asset → applicable standards → cadence. Item 8 is a greenfield schema.

9. **No offline code of any kind.** No service worker, no `workbox`, no `idb`/`dexie`, no `navigator.onLine` checks. Item 6 is fully greenfield on the client.

10. **Tests are minimal.** Vitest is configured (`test`, `test:watch`). Only 5 unit test files, all utility-level (`auth.test.ts`, `csv-parser.test.ts`, `format.test.ts`, `roles.test.ts`). No integration tests, no E2E. Any sprint that ships load-bearing features should add tests as part of the story.

11. **Single dashboard, not per-persona.** `app/(app)/dashboard/page.tsx` is one unified view for all roles. Item 19 is greenfield.

12. **No ML, no AI calls.** No `anthropic`, no `openai`, no stats libraries, no embeddings. Items 20–22 are fully greenfield and need an API-key story via the Cloudflare Worker proxy (per the invariants).

13. **CI is tsc + npm audit only.** `.github/workflows/ci.yml` runs `npx tsc --noEmit` and `npm audit --audit-level=high`. No vitest run, no audit SQL, no lint gate.

14. **Max migration is 0043.** `0043_sy1_reconciliation.sql` is the head, confirming the snapshot.

15. **Media library confirmed.** `0033_media_library.sql` adds the table with RLS; `0034` adds `sites.photo_url`. `0031_report_settings_expansion.sql` adds report complexity + logo + customer-logo toggle + site-photos toggle.

**Net effect on the plan:** items 11 and 13 become cheaper, item 5 needs a schema decision, and items 2–4 are more expensive than they look because there is no PDF toolchain yet.

---

## Section 2 — Effort, Dependency, Leverage, Risk Matrix

Effort key: **S** ≤1 day · **M** 2–5 days · **L** 1–2 weeks · **XL** ≥3 weeks. Leverage is how much it moves the product toward a paying sale to SKS or a credible second customer.

| # | Item | Effort | Dependencies | Leverage | Key risk |
|---|---|---|---|---|---|
| 1 | NSX/MCCB Steps 2 & 3 to ACB parity | M | none | High | Field-spec drift — need signed-off checklist before build. Lower risk than it looks because ACB is a direct template. |
| 2 | O&M manual PDF generator | L | needs PDF toolchain (shared w/ 3, 4) | **Very High** | PDF rendering fidelity; image embedding of media library assets; large file sizes for 4,700-asset sites. |
| 3 | MOP / commissioning doc generator | M | 2 (shared PDF toolchain) | High | Format varies by end client (Equinix vs Schneider) — template per client. |
| 4 | Per-asset branded test certificate PDFs | M | 2 | High | Signature/stamp handling; immutable versioning so a re-issued cert supersedes cleanly. |
| 5 | Defect → WO → sign-off closure loop | L | schema decision on work_orders table | High | Schema churn if we later integrate an external WO system (Maximo, Pronto). Build the table as a thin internal record and tag it with `external_ref` from day one. |
| 6 | Offline-first mobile mode | XL | 1 (to have both workflows complete) | Very High | Merge conflicts on test records; cached RLS context staleness; attachment uploads while offline; service-worker cache invalidation. Highest-risk item on the list. |
| 7 | Read-only customer portal | L | new `customer` role + RLS on every customer-facing table | Very High | RLS leakage — this is the #1 security surface. Every policy needs explicit `USING (customer can only see their own tenant's data via their customer_id link)`. Needs a dedicated security review. |
| 8 | Compliance-by-standard mapping | M | 5 (ideally) | Medium | Reference data quality — standards change, cadences vary by site. Store standard + effective_from + effective_to. |
| 9 | SOC 2 Type 1 prep pack | L | 11, 13 | Medium | Mostly documentation + evidence collection. Low technical risk, high calendar drag. |
| 10 | Public uptime / status page | S | none | Low | Trivial via Netlify or a third-party (BetterStack, Instatus). Mostly optics. |
| 11 | Wire `audits/run.sql` into CI | S | none | High | Must not block unrelated PRs on pre-existing WARNs — start non-blocking, promote to blocking per-check. |
| 12 | Supabase branch DBs for PR previews | M | none | Medium | Branch cost, seed-data strategy, merge-back hygiene. |
| 13 | Supabase advisor WARN cleanup | M | none | Medium | `auth_rls_initplan` fixes require wrapping `auth.uid()` in `(select …)` across 24 policies — mechanical but touches every table. Duplicate and unused indexes are pure cleanup. |
| 14 | Backup restoration drill | S | none | Medium | None technical; pure runbook + one quarterly execution. |
| 15 | Freshness / timeliness checks | S | 11 | Low | Just more rows in `audits/run.sql`. |
| 16 | Field tech mobile UX pass | M | 1, ideally 6 | High | Subjective — needs a field tech in the loop, not just dev judgement. |
| 17 | Bulk operations UI | M | none | Medium | Audit log volume; idempotency for batch ops. |
| 18 | Keyboard shortcuts + command palette | S | none | Low | Purely additive. |
| 19 | Per-persona dashboards | M | 7 (for customer dashboard variant) | Medium | Yet-another-route pattern; easy to over-engineer. |
| 20 | Test-result anomaly detection | L | 1 (NSX complete) + data volume | Medium | Statistical soundness — z-score on small samples is noisy; needs a minimum-sample gate. Also a major UX surface ("why is this flagged") that costs as much as the stats. |
| 21 | AI-assisted defect → WO suggestion | L | 5, Cloudflare Worker proxy for LLM key | Medium | Hallucination into an audit-logged system. Must be strictly advisory, never auto-apply. |
| 22 | Natural-language compliance query | XL | 20 or 21 as precursor | Low–Medium | Schema-aware tool calling is hard; easier to demo than to ship reliably. Most exciting, least load-bearing. |

---

## Section 3 — Recommended Build Order

Royce's gut pick: **1, 2, 6, 7, 11, 20**. I agree on 1, 2, 7, and 11. I want to **defer 6 (offline)** past Sprint 2, **defer 20 (anomaly detection)** until after the portal ships, and **insert 3, 4, 5, 13** ahead of them. Justification below the table.

### Sprint 1 (next 2 weeks) — "Make it obviously sellable"

1. **Item 11** — Wire `audits/run.sql` into CI. (S) Half a day. Unblocks the DQ story for every subsequent sprint and costs almost nothing because the SQL already exists.
2. **Item 1** — Finish NSX/MCCB Steps 2 & 3 to ACB parity. (M) The single biggest "your product is half-built" demo risk. ACB gives us the exact template.
3. **Item 2** — O&M manual PDF generator, including the shared PDF toolchain. (L — spans into Sprint 2) Start the toolchain decision (Playwright vs `pdf-lib` vs Netlify function) here because items 3 and 4 depend on it.

### Sprint 2 (weeks 3–4) — "Finish the deliverables story"

4. **Item 3** — MOP / commissioning document generator. (M) Reuses the PDF toolchain from item 2. Equinix + Schneider templates.
5. **Item 4** — Per-asset branded test certificate PDFs. (M) Same toolchain, different template, adds a `certificates` table with immutable versioning.
6. **Item 13** — Supabase advisor WARN cleanup, Phase 1. (M) Specifically the `auth_rls_initplan` fixes — wrap `auth.uid()` and `get_user_tenant_ids()` in `(select …)` across the 24 offending policies. Keeps performance from tanking as customers grow.

### Sprint 3 (weeks 5–6) — "Close the loop and open the gate"

7. **Item 5** — Defect closure loop with a new `work_orders` table, sign-off, audit trail. (L)
8. **Item 7** — Read-only customer portal, using a new `customer` role. (L) Sequenced after item 5 because the portal should expose defect + WO state, which gives the customer a genuine reason to log in beyond the compliance dashboard.
9. **Item 11 part 2** — Add freshness/timeliness checks (item 15) to the audit framework now that we have data-age signals from the portal traffic.

### Deferred to Sprint 4+

- **Item 6 (offline).** Biggest risk, biggest payoff, but it needs items 1, 4, and 5 to all be stable first so technicians have a reason to want it offline. Shipping offline on top of a half-finished NSX would create sync chaos.
- **Item 20 (anomaly detection).** Needs meaningful data volume per asset. We have ~4,700 assets but few have >2 test instances yet. Revisit once the first FY of real tests accumulates.
- **Items 8, 9, 10, 12, 14, 16–19, 21, 22.** All worthwhile; none load-bearing for the sale.

### Where I'm deviating from your gut pick

- You had **item 6 (offline)** in the top five. I'm deferring it. **Reason:** it's the single highest-risk, highest-effort item on the list, and it bites hardest if NSX Steps 2–3 are still placeholders when a technician is in the field with no connection. Ship 1 → 2 → 3 → 4 → 5 first so there's a complete, audit-trail-sound workflow to take offline.
- You had **item 20 (anomaly detection)** in the top five. I'm deferring it. **Reason:** without NSX complete and without 6–12 months of test history per asset, z-score flags will be either all-noise or trivially explainable. Build the data substrate first, then the ML layer.
- I'm promoting **items 3, 4, and 13** into the first two sprints. 3 and 4 come nearly free once 2 ships (same toolchain, different templates). 13 is a pure hygiene payment that the next customer migration will force anyway.

---

## Section 4 — Sprint 1 Spike: Item 11 (Wire `audits/run.sql` into CI)

Item 11 is first because it's small, it de-risks every subsequent sprint, and it gives you a deployable artifact in ~half a day. Details follow.

### Goal

Every PR that touches `supabase/migrations/**`, and every push to `main`, runs `audits/run.sql` against a throwaway snapshot of the Supabase project and fails if any ERROR-level check fails. WARN-level checks are tabulated and posted as a PR comment but do not block.

### Files to create or modify

**New:**
- `.github/workflows/data-quality.yml` — GitHub Action definition.
- `audits/runner/run-audit.mjs` — Node script that executes `run.sql` via the Supabase MCP or the PostgREST RPC, parses the result, classifies by level, emits a GitHub Actions summary, and exits non-zero on ERROR.
- `audits/runner/format-summary.mjs` — helper that turns the result set into a markdown table for `$GITHUB_STEP_SUMMARY` and for the PR comment.
- `audits/runner/post-comment.mjs` — optional helper that uses `actions/github-script` to post/update a sticky PR comment with the WARN tabulation.

**Modified:**
- `.github/workflows/ci.yml` — add a matrix dependency so `data-quality` is a required check on PR.
- `audits/run.sql` — add a `level` column to the output if not already present (verification pass didn't confirm the output shape — check first). Needs to emit `ERROR` | `WARN` per row.
- `audits/CHECKS.md` — add a "CI behaviour" section documenting the ERROR/WARN split and how to grant an explicit waiver (comment in the SQL header, reviewed in PR).

**No database migration is required for Sprint 1 item 11.** The audit script is read-only.

### Server actions

None. This sprint is pure CI and SQL — no app-layer changes.

### UI surfaces touched

None.

### Migration sketch

Not applicable to item 11. The migration sketch below is the one you'll need for **item 2 (O&M PDF generator)** which is also in Sprint 1 — included here because you asked for the "first item in Sprint 1 one level deeper" and the PDF toolchain decision is the load-bearing one.

```sql
-- migrations/0044_pdf_generation_jobs.sql (sketch — not applied)
create table public.pdf_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('om_manual','mop','commissioning','certificate','bulk_report')),
  entity_type text not null,       -- 'site' | 'asset' | 'test'
  entity_id uuid not null,
  requested_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','running','complete','failed')),
  file_url text,                   -- storage path once generated
  file_size_bytes bigint,
  error text,
  mutation_id text,                -- for withIdempotency()
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.pdf_generation_jobs enable row level security;

create policy "tenant members read their jobs"
  on public.pdf_generation_jobs for select
  using (tenant_id in (select public.get_user_tenant_ids()));

create policy "writers create jobs"
  on public.pdf_generation_jobs for insert
  with check (
    tenant_id in (select public.get_user_tenant_ids())
    and public.get_user_role(tenant_id) in ('super_admin','admin','supervisor','technician')
  );

create unique index pdf_jobs_tenant_mutation_uniq
  on public.pdf_generation_jobs (tenant_id, mutation_id)
  where mutation_id is not null;

create trigger pdf_jobs_updated_at
  before update on public.pdf_generation_jobs
  for each row execute function public.set_updated_at();
```

### Test cases that must pass before item 11 is "done"

1. `gh workflow run data-quality.yml` against a clean `main` exits 0 and posts a summary.
2. Injecting a deliberate RLS regression (e.g. a new table without RLS in a test migration) causes the workflow to exit non-zero with a message identifying the check and the row count.
3. A pure-WARN finding (e.g. an unused index) does **not** fail the build but **does** appear in the PR comment.
4. The workflow skips for PRs that don't touch `supabase/migrations/**`, `audits/**`, or `.github/workflows/data-quality.yml` — except on `main`, where it always runs.
5. Two consecutive runs against the same commit produce byte-identical summaries (determinism — important so re-runs don't flap).

### Security invariant attention

- The workflow must **never** print the `service_role` key or any row-level data containing PII. The audit script output must be counts + identifiers only, never `auth.users.email` or `tenant_members.user_id`. This is explicitly called out in AGENTS.md.
- Credentials come from GitHub Actions secrets, not `.env` files, and rotate on the same cadence as Supabase advisors.
- The workflow must run against a **read-only** role. Create a new `audit_runner` role in Supabase with `SELECT` on the schemas the checks touch, and use that role's key — not `service_role`.

---

## Section 5 — Risks and Open Questions

### Open questions for Royce

1. **PDF toolchain choice (blocks item 2).** Three realistic options:
   - **Playwright in a Netlify function** — highest-fidelity (renders the same React the app renders), easiest to brand, slowest cold start, heaviest deploy artifact.
   - **`pdf-lib`** — lightweight, programmatic, perfect for per-asset certificates (item 4), painful for long manuals with complex layouts (item 2).
   - **`@react-pdf/renderer`** — middle ground, reasonable fidelity, limited CSS support.
   My lean: Playwright for items 2 and 3, `pdf-lib` for item 4. That means two toolchains, which is the honest cost. Confirm before I start item 2.
2. **Work-order model (blocks item 5).** Do you want `work_orders` as a standalone internal table with its own lifecycle, or a thin metadata layer over the existing `check_assets.work_order_number` free text, with eventual export to an external WO system like Maximo/Pronto? The first is a sharper product; the second is cheaper and lower-risk if SKS already has a WO system they want to integrate.
3. **Customer portal scope (blocks item 7).** Read-only dashboard only, or does it include defect raise and comment? Read-only is 1 week; write-capable is 2–3 weeks and needs a new audit-log surface for customer-originated actions.
4. **Sprint 1 capacity.** Items 11 + 1 + 2 is realistic if item 2 slips into Sprint 2. Items 11 + 1 alone is very realistic. Confirm which you want.
5. **Equinix/Schneider template access (blocks items 3 and 4).** Can you get sample O&M and MOP templates from current SKS projects so I can build to format, or do we freelance a "good enough" version and iterate?

### Risks I want you to see

- **Item 6 (offline) is bigger than it looks.** Offline-first is not a sprint; it's a rearchitecture. If you're determined to put it in Sprint 3, plan for it to take all of Sprint 3 and half of Sprint 4, and expect a round of defect cleanup after launch. Every field I add to a test record between now and then is a field I'll have to think about for conflict resolution.
- **Advisor WARN cleanup (item 13) is touchier than it sounds.** Rewriting 24 RLS policies to wrap `auth.uid()` in `(select …)` is mechanical but the blast radius is every tenant-scoped query. Do it in one migration, not twenty, and validate against production advisors before merging. I'd do it on a branch DB (item 12) if item 12 were already done — which is an argument for doing item 12 before item 13, and a fair reason to swap them in Sprint 2.
- **Customer portal is the biggest security surface we haven't built yet.** Budget a half-day security pass for item 7 that's not part of the feature dev — read every new RLS policy aloud with a second set of eyes. RLS bugs in this path are "lose the customer" bugs.
- **PDF generation fidelity will disappoint at first.** Any path you pick, the first draft will look 80% right and the last 20% will take longer than the first 80%. Don't promise a pilot customer a perfect O&M manual in Sprint 1.

### Counter-view — the one item on your list I think is wrong-headed

**Item 22 (natural-language compliance query).** Every SaaS that ships this either (a) ships a demo that breaks on the second question, or (b) spends six months building a tool-calling harness that's worse than the existing filters page. It is cooler than it is useful. I'd cut it from the 22 and reinvest the effort into **better saved views + URL-sharable filters** on the existing pages — which is 90% of the "natural-language query" value at 10% of the cost, and which a customer will actually use every day. Push back on me if you disagree.

### Things I don't know and would have to research before Sprint 2

- Current Netlify plan limits on function execution time (Playwright PDF generation for a 4,700-asset O&M manual may exceed the free-tier 10s cap — pro tier is 26s, background functions are 15 minutes).
- Whether the existing `audit_logs` table has indices that will handle the write volume a PDF-generation queue will add.
- Whether the existing `media_library` can host generated PDFs or whether we want a separate `documents` bucket with different retention.

---

## Section 6 — Mid-session decisions (2026-04-16)

Decisions taken autonomously during the 2026-04-16 autonomous work block, within the constraints of "low-impact items that don't need Royce's input". None of these touch the code-ship items (1, 2, 11) already logged in `sessions/2026-04-16.md`; these are purely plan adjustments and one runbook + one SQL tidy-up.

### Decisions

1. **Cut item 22 (natural-language compliance query) from the roadmap.** Rationale in Section 5's counter-view still stands and Royce's silence on a pushback counts as acceptance for a low-impact cut. The reinvestment target — saved views and URL-sharable filters — is added to the backlog as a new item **22a**, unranked, to revisit in the next planning pass.

2. **Defer item 10 (AI-assisted triage / recommendations).** Same class as 22 — needs an API-key story via the Cloudflare Worker proxy and a UX pass before it can start. Parked until Sprint 4 at the earliest. No effort spent this session.

3. **Defer item 18 (advanced RBAC) behind item 19 (per-persona dashboards).** Rationale: RBAC granularity only matters once each persona has a distinct landing experience. Building RBAC first leads to permissions that nothing consumes. Item 19 first, item 18 second.

4. **Couple item 12 (branch DB workflow) to item 13 (advisor WARN cleanup).** Per the Section 5 risk note — "I'd do it on a branch DB (item 12) if item 12 were already done" — item 12 is promoted ahead of item 13 in Sprint 2. Sprint 2 order is now: 12 → 13 → 3 → 4. Item 12 is a small scripting + docs pass so this doesn't expand the sprint.

5. **Item 14 (backup restoration drill) — runbook shipped.** New file: `docs/runbooks/supabase-backup-restore.md`. Quarterly cadence (first week of each quarter), documented procedure covering backup verification, drill target creation (branch preferred / throwaway project fallback), restore via psql, audit-based sanity check, app smoke test, and teardown. **No actual restore was fired in this session** — this is the runbook only. First drill is due 2026-07-06. Moves item 14 from "start Sprint 3" to "doc shipped; quarterly cadence in place" — the remaining work is running the first drill and recording findings, which is an ops task not a build task.

6. **Item 15 (data quality framework) — freshness checks added.** Three WARN-level DAMA timeliness checks appended to `audits/run.sql`:
   - `freshness.defects.open_over_90_days`
   - `freshness.acb_tests.in_progress_over_30_days`
   - `freshness.nsx_tests.in_progress_over_30_days`

   All WARN-level so they don't block CI. `audits/CHECKS.md` gains a new "Freshness / timeliness" section documenting each check with the rationale and noting the not-yet-added `pm_calendar`/`maintenance_checks` overdue checks as a follow-up, pending column-name confirmation. Combined with item 11 (CI wiring), item 15 is now substantively complete — the only remaining work is the two deferred checks and the accuracy/attachment-orphan gaps already documented in CHECKS.md under "Not currently checked".

### Updated sprint order

Sprint 1 unchanged: 11, 1, 2.
Sprint 2: **12 → 13** → 3 → 4 _(12 promoted ahead of 13 per decision 4)_.
Sprint 3: 5, 7, **19 → 18** _(19 before 18 per decision 3)_; item 6 remains deferred.
Parked: 10, 22 _(cut)_.
Complete / doc-shipped: 14 (runbook), 15 (freshness checks + framework already in place).

### What still needs Royce

Decisions that were **not** taken autonomously because they need Royce's input:

- **Item 2 — PDF toolchain choice** (Playwright vs `pdf-lib`). Still open. Section 5 Q1.
- **Item 5 — work-order model scope** (standalone table vs thin metadata on `check_assets`). Still open. Section 5 Q2.
- **Item 1 follow-up — NSX checklist trimming.** The verbatim ACB port includes ACB-era items (arc chute, spring charging, ops counter) that are less relevant on moulded-case breakers. A field tech pass is required to finalise the NSX-specific list. No schema change needed when it happens.
- **Item 7 — customer portal security pass.** Flagged in Section 5 risks — this one gets a half-day dedicated security review before it ships, with a second set of eyes on every new RLS policy.

---

---

## Section 7 — Constraints from Royce (2026-04-16, end-of-day)

Answers to the open questions in Section 6, after the external engineering review (`docs/reviews/2026-04-16-external-engineering-review.md`):

1. **Rollout:** Internal, SKS first. No external customer portal in the immediate horizon.
2. **Reports:** Per-maintenance-check, issued to customer. Unit of work is 1 maintenance check → 1 report → 1 delivery.
3. **Supabase:** Already on the paid tier. PITR, branching, higher function limits available today.
4. **Team:** Solo engineer for the foreseeable future.

### Revised sprint plan — Royce-ordered (supersedes all earlier orderings)

Royce reordered: product-facing features first, infrastructure hardening after.

**Phase 1 (start here) — Per-persona dashboards + work-order + PDF:**
- Item 19 — per-persona dashboards (technician / supervisor / admin landing pages). Highest-value internal-UX item for the SKS rollout. ~3 days.
- Item 2 — DOCX → PDF conversion at the report delivery boundary. Headless Chromium via Supabase Edge Function (paid-tier unlock). Per-check reports only. ~2 days. Design: `docs/architecture/report-delivery.md`.
- Item 5 — work-order closure loop. Thin metadata on `check_assets`. ~2 days.

**Phase 2 — Customer portal + report delivery pipeline:**
- `report_deliveries` table + migration (design: `docs/architecture/report-delivery.md`). ~1 day.
- `issueMaintenanceReportAction` server action — PDF + DOCX generation, signed-URL email via Resend, SHA-256 tamper hash, revision model. ~2 days.
- `/portal` route — magic-link auth against `customers.contact_email`, "Your reports" page reading from `report_deliveries`. ~3–5 days.
- Revocation flow, download tracking, hash verification tool. ~1 day.

**Phase 3 — Integration tests + advisor cleanup + CHECK constraints:**
- Integration tests for ACB/NSX server actions against a branch DB. Happy path + cross-tenant isolation + role-gate negative. ~2 days.
- Item 13 — advisor WARN cleanup, run against the branch DB. ~1 day.
- Promote postcode / state / `performance_level` from audit-layer to Postgres `CHECK` constraints. ~half day.
- Report delivery pipeline refinements from Phase 2 learnings. ~1 day.

**Phase 4 — Quick infrastructure hardening:**
- Turn on PITR in the Supabase dashboard. Update `docs/runbooks/supabase-backup-restore.md` with the new RPO floor. ~5 minutes.
- Wire `npm test` into `.github/workflows/ci.yml` so the existing 4 unit tests gate merges. ~10 minutes.
- Stand up the Supabase branch workflow (item 12). Document commands in `docs/runbooks/branch-workflow.md`. ~half day.
- Install OpenTelemetry + Axiom (free-tier log backend). Propagate `request_id` through middleware → server actions → `audit_logs.request_id`. ~1 day.

**Later:**
- Item 6 — offline. Unblocked by idempotency + job-queue + request-id.
- Partitioning plan documented in `docs/architecture/partitioning.md` (not executed).
- Migration squash / baseline policy documented, scheduled for v1.0.0.

### Further deferrals / cuts under solo-engineer constraint

- **Feature flags table** — demoted from Sprint 3 to "build it the first time a differential rollout is needed". With one tenant, differential rollout is not load-bearing.
- **Storybook / component catalogue** — defer indefinitely. Team-leverage play, team is one person.
- **Read replicas** — not until customer #2.
- **Item 7 security review half-day** — removed from Sprint 3 (portal moved out).

### The solo-engineer calibration

The worst-case scenario this plan is calibrated against is *not* "a feature ships late". It is "Royce is on leave and a production bug corrupts maintenance-check data the morning before a compliance submission". PITR, tests in CI, OpenTelemetry, and idempotent report regeneration are four pieces of insurance against that scenario. Everything that does not reduce the blast radius of a production incident waits until there is a second engineer or a second customer.

---

**End of plan — authoritative as of 2026-04-16 end-of-day.** Section 7 supersedes Section 5 ordering where they conflict. Original sections are preserved for the decision trail.
