# Overnight work — 2026-05-19

Royce authorised an overnight autonomous session covering four work items.
This doc tracks progress in real time and becomes the morning report.

## Scope (locked 2026-05-18 evening AEST)

1. **EQ Shell integration research** — read `C:\Projects\eq-shell` + design doc,
   produce proposal at `docs/audits/2026-05-19-eq-shell-integration.md`
   covering auth-contract fit, integration options, recommendation,
   file-by-file work estimate.
2. **Browser UX walkthrough** of creation flows on a local dev server —
   validate the [2026-05-18 audit](2026-05-18-creation-flows-ux.md) findings,
   capture screenshots / console / network, surface any new findings.
3. **Test scaffolding** for the friction paths uncovered by the audit —
   Playwright/Vitest skeletons in `tests/`, committed but not merged.
4. **CI cleanup** — fix the broken integration tests (`job_plans.site_id`
   seed issue) and triage `npm audit` (4 vulns on main: high `next` +
   `protobufjs`, moderate `postcss` + `@protobufjs/utf8`).

## Safety constraints in force

- **No merges.** Every PR opened tonight waits for Royce review in the
  morning.
- **No auth changes.** Anything touching `proxy.ts`, MFA, sign-in flow,
  or the EQ Shell auth contract is strictly research-only.
- **No deploys.** No `git push --force`, no Netlify env tweaks, no
  production-side actions.
- **No schema migrations.** Anything that would write to
  `supabase/migrations/` waits for daytime.
- **Posture: fix-anything-confident** — Royce's chosen aggression level
  for trivial / obvious fixes (typos, dead links, null checks). Subject
  to the four nons above.

## Progress log

| Time (UTC) | Item | Status | Output |
|---|---|---|---|
| 13:30 | Setup — new branch `overnight/2026-05-19`, progress doc created | done | this doc |
| 13:40 | Fired 3 parallel agents (first attempt, no worktree isolation) | aborted | race condition on shared worktree — branches `ci/*` were stomping each other |
| 13:50 | Re-fired 3 agents with `isolation: "worktree"` | running | shell integration research / npm audit fix / RLS test seeds |
| 13:55 | Local dev env setup for browser walkthrough | done | .env.local copied + npm install clean |
| 14:00 | Browser preview attempt — Next.js dev server | **blocked** | Dev server serves HTML with full content (curl confirms 200 + signin markup), but the headless Chromium preview is stuck on the root `loading.tsx` splash. JS chunks load, no console errors, HMR connected, but the React tree never resolves past the Suspense fallback. Suspect Next 16 / Turbopack / headless-Chromium interaction. **Pivoting to code-driven validation.** |
| 14:05 | Agent C (RLS test fix) returned | **done** | [PR #150](https://github.com/Milmlow/eq-solves-service/pull/150) — adds `site_id` to job_plans inserts in 3 test files. **Schema-drift finding:** live Supabase has migration `20260408083137_job_plans_nullable_site_id` that drops `site_id` NOT NULL — that migration is NOT in `supabase/migrations/`. Backlog item. |
| 14:25 | Agent A (shell integration research) returned | **done** | [PR #151](https://github.com/Milmlow/eq-solves-service/pull/151) — recommendation: **Option B (auth-share + redirect)**. New `/auth/shell-bridge` route on Service validates a 60s HMAC token minted by shell, then uses Supabase admin magic-link to sign in. Avoids iframe's `frame-ancestors 'none'` CSP conflict. ~360 LOC across ~5 files. Flagged: (i) shell repo is still Phase 1.A scaffold — auth functions don't yet exist; (ii) bridge route IS an auth-flow change, needs explicit chat heads-up before code lands per AGENTS.md. |
| 14:27 | Agent B (npm audit fix) returned | **done** | [PR #152](https://github.com/Milmlow/eq-solves-service/pull/152) — `npm audit fix` clean, lockfile-only diff (139+/191-). Bumps `next` 16.2.3→16.2.6, `postcss` 8.5.8→8.5.14, `protobufjs` 7.5.5→7.5.9, `@protobufjs/utf8` 1.1.0→1.1.1. `npm audit --audit-level=high` exits 0 (CI invariant met). 2 moderate findings remain — nested `postcss@8.4.31` vendored by `next@16.2.6`; below CI threshold. `npm run check` passes. |
| 14:30 | Item 2 (browser walkthrough) — reassessed | **delivered as code-driven validation** | Browser preview blocker unresolved; pivoted to deep code-read of the audit findings + RLS-level verification. RCD bug in §2.1 verified to be **purely a client-side `canEdit` gate** — the RLS policies on `rcd_tests` + `rcd_test_circuits` (migration 0069) already include `'technician'` in the allowed roles for INSERT and UPDATE. So PR A's fix changes only UI, not security model. |
| 14:35 | Item 3 (test scaffolding) — reassessed | **deferred** | Useful tests for PR A's behaviours need React Testing Library setup (not present in repo today). RLS layer already correctly permits the tech operations — no integration test needed there. Recommend RTL setup as its own follow-on PR before PR A; otherwise PR A ships without component-level regression coverage. |
| 14:45 | **Item 5 — competitive feature audit** added to scope by Royce | running | Agent kicked off researching simPRO / ServiceTitan / Tradify / AroFlo / Fergus / Limble / UpKeep / MaintainX / IBM Maximo. Deliverable: `docs/audits/2026-05-19-competitive-features.md` covering feature-gap matrix, table stakes, and differentiation angles. |
| 14:55 | Agent (competitive audit) returned | **done** | [PR #154](https://github.com/Milmlow/eq-solves-service/pull/154) — 5,481-word audit across 9 vendors. **Headline:** eq-service is structurally a CMMS sold to a trades business serving enterprise asset owners; closer to MaintainX than simPRO. Strategic call: deepen CMMS / compliance side, ignore trades-platform path. Top 3 gaps + Top 3 differentiators + Top 3 don't-chase items below. |

---

## Morning summary — read this first

**TL;DR:** 3 of 4 items delivered as PRs, 1 deferred with documented reason. 4 PRs to review (PR #149 from yesterday + 3 from tonight). Two outside-the-PRs findings worth knowing about: schema-drift, and the EQ Shell repo's current state.

### PRs to review (in priority order)

| # | Title | Size | Risk | Recommendation |
|---|---|---|---|---|
| [149](https://github.com/Milmlow/eq-solves-service/pull/149) | docs: UX audit of creation flows for go-live | 864 lines, doc-only | nil | Merge after a skim — source of truth for the upcoming PR A-J work |
| [150](https://github.com/Milmlow/eq-solves-service/pull/150) | test: fix RLS integration test seeds — job_plans site_id | 3 test files, +3 lines | nil | Merge — clears 3 CI suites that were red |
| [151](https://github.com/Milmlow/eq-solves-service/pull/151) | docs: EQ Shell integration proposal for EQ Service | doc-only | nil | Read & decide on Option A/B/C before any shell-side work starts |
| [152](https://github.com/Milmlow/eq-solves-service/pull/152) | chore: npm audit fix — clear 4 advisories on main | lockfile-only | **medium — Next.js patch bump** | Merge after CI runs green — bumps Next 16.2.3 → 16.2.6, deserves a sanity check on the deploy preview before merge |
| [154](https://github.com/Milmlow/eq-solves-service/pull/154) | docs: competitive feature audit — pre-launch landscape | 5,481 words, doc-only | nil | Strategic read; influences the post-launch roadmap. Decisions to take from this: positioning (CMMS not trades platform) + which gaps to close vs ignore |

### Competitive audit — strategic findings (PR #154 distilled)

**Positioning call to make:** eq-service is structurally a **CMMS** (asset-and-maintenance focused) sold to a **trades business** whose customers are **enterprise asset owners** (Equinix, Jemena). That makes the closest peer **MaintainX**, not simPRO. The implication is that the post-launch roadmap should deepen CMMS / compliance, not chase trades-platform features.

**Top 3 gaps to close (in PR #154's priority order):**
1. **Scheduling-dispatch board** — every competitor has a calendar+drag-and-drop view assigning techs to checks across days. eq-service has the data (checks have `assigned_to` + `due_date`) but no scheduler UI. Medium scope.
2. **Installable PWA + offline queue** — UpKeep / MaintainX / Limble are mobile-first with offline. The audit's §B.13 "Network drop loses data" finding is the symptom; this is the structural fix. Large but high-leverage.
3. **Per-item photo-required-on-fail** — competitors enforce photo evidence on failed inspection items. Eq-service has attachments at the check level but not per-item gating. Small scope; clear compliance win.

**Top 3 differentiators to deepen (where eq-service already leads):**
1. **Compliance-grade reporting** — RCD per-circuit timing tables, ACB protection-setting matrix, Customer Report bundle. None of the listed competitors generate AS/NZS-compliance-ready evidence at this depth.
2. **Enterprise-import fluency** — Maximo Delta multi-file consolidation + Jemena multi-tab RCD xlsx. CMMS competitors expect manual entry; eq-service ingests the customer's actual systems-of-record.
3. **Three-tier job-plan model** — global / customer-scoped / site-scoped. None of the listed competitors has a comparable scoping primitive; everyone else does either per-asset templates or per-site forms.

**Top 3 "don't chase":**
1. **Full CRM** (ServiceTitan-style — pipelines, lead routing) — wrong buyer.
2. **In-app merchant payments** (Stripe/PayPal collection on invoices) — duplicates Xero/MYOB which most contractors already run.
3. **Parts marketplace** — AU licensed-trade rules make it a regulatory minefield.

**Cross-references the audit flags:**
- The recommendations need a sanity check against the **Phase C tier framework** so we don't accidentally promise Enterprise-tier features at Starter pricing. (See the tier-framework memory entries.)
- Several recommendations interact with the **EQ Shell integration** (PR #151) — e.g. a scheduling-dispatch board is more valuable when other modules (Field, Cards) feed into the same calendar.

### Outside-the-PRs findings

#### 1. Schema drift — `job_plans.site_id` NOT NULL on local, nullable on live

Local `supabase/migrations/` declares `job_plans.site_id` as NOT NULL
(migration 0002). Live Supabase has migration `20260408083137_job_plans_nullable_site_id`
that drops the NOT NULL constraint. This migration is missing from the repo.

Net effect:
- Local dev + CI integration tests see `site_id` as NOT NULL (cause of the 3 RLS test fails fixed in PR #150)
- Live production correctly allows null site_id for global / customer-scoped job plans, as CLAUDE.md describes
- Anyone resetting their local DB or running migrations fresh recreates the divergence

**Action recommended:** create migration 0xxx (current is 0095) named identically — `job_plans_nullable_site_id` — and check it in. The live state stays unchanged because that migration's effect is already applied. Future fresh checkouts then match live.

#### 2. EQ Shell repo is still Phase-1.A scaffold

The shell integration research (PR #151) found that `C:\Projects\eq-shell\`
does not yet contain the auth functions (`shell-login`, `verify-shell-session`,
`mint-iframe-token`), the `session.ts` context, the `brand.tsx` provider, or
the `FieldIframe.tsx` page that the README + this codebase's CLAUDE.md describe.
Those are the Phase-1.B deliverables — not yet committed.

**Action recommended:** the integration proposal in PR #151 plans against
the locked design intent in `EQ-SHELL-DESIGN.md` (Q1-Q10), not against
running code. When the shell side ships its Phase 1.B functions, re-validate
the proposal's assumptions against the actual implementations.

#### 3. Browser-preview blocker for future overnight sessions

The headless Chromium preview that ships with Claude Code can't render this
Next.js 16 / Turbopack / React 19 app correctly — server-rendered HTML
contains the signin form, but the preview tree is stuck on the
`app/loading.tsx` Suspense fallback indefinitely. `curl` returns 200 with
the right HTML in 236ms. All JS chunks load; no console errors; HMR
connects. The mismatch is between the streamed RSC payload and the
preview's hydration handler.

**Action recommended for future browser-walkthrough nights:** test the
preview pipeline against this repo end-to-end during daytime first, before
locking it into an overnight scope. Or use a non-headless Chromium for the
hard cases.

#### 4. Two moderate vulnerabilities remain after npm audit fix

Both are nested `postcss@8.4.31` instances vendored by `next@16.2.6` as a
hard-pinned dep. `npm audit fix --force` would only clear them by
downgrading `next` to 9.3.3 — unacceptable. Below the CI threshold; not
blocking the invariant. Leave for the next Next.js minor.

### Test scaffolding (Item 3) — deferred and why

The audit's friction items split into two camps for testability:

- **Already covered by existing RLS tests** — technician update gating on
  `maintenance_checks` (`technician-update-gating.test.ts`); cross-tenant
  isolation; admin-only delete. PR A doesn't change the RLS layer; these
  tests already cover the data-layer regression surface.
- **Need React Testing Library** — sidebar role-based hiding, TechDashboard
  component contents, inline disabled-reason rendering. These are pure UI
  concerns. RTL is not currently set up in this repo (no `@testing-library/react`
  in `package.json`, no test config matching `.test.tsx` for component
  tests).

**Recommendation:** open a small PR adding RTL config (`vitest.component.config.ts`
+ a couple of dependency adds) before PR A starts. Then PR A includes
component tests for each behaviour change. Trying to scaffold tests
without the infra would produce dead files.

### Next-morning priorities

1. **Re-read PR #149 (UX audit doc)** — 10-minute skim refreshes context for everything below
2. **Merge PR #150** if you agree with the test fix
3. **Decide on the schema-drift fix** (create the missing migration?)
4. **Read PR #151 + decide on Option A/B/C** for the EQ Shell integration
5. **Merge PR #152** after a deploy-preview sanity check
6. **Read PR #154 + decide on positioning** — CMMS or trades platform? This decision shapes which PR A-J items get priority and which Phase C tier-framework items move
7. **Authorize the RTL-setup PR** if you want PR A to have component-test coverage
8. **Kick off PR A** (tech permission + dashboard + sidebar) — fully scoped in §4 of PR #149's doc

### What I did NOT touch overnight

- Any auth code (`proxy.ts`, signin, MFA paths) — respected the AGENTS.md invariant
- Any schema migrations — even the obvious one for `job_plans.site_id` (flagged for daytime)
- Production deploys, Netlify env vars, branch protection settings
- Merged anything — all 4 PRs wait for your review
- The eq-shell repo's source files — read-only, no edits

