# Field unification plan

**Status:** draft (2026-05-24) — awaiting Royce's review before code starts.
**Companion to:** [ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) (the per-tenant data-plane cutover this plan builds on).
**Goal:** collapse three Field deployments (EQ Field demo, EQ Field "advanced/enterprise", SKS NSW Labour) into **one unified codebase** served per-tenant from `core.eq.solutions/<tenant>/field`, leveraging the per-tenant Supabase data plane shipped in Phase 2.

---

## TL;DR

- Today: three Field deployments exist (`eq-solves-field.netlify.app` demo, the implicit advanced/enterprise tier on the same codebase, and the LIVE `sks-nsw-labour.netlify.app`).
- Constraint: **SKS NSW Labour is live production**. Cannot be broken. (Royce's standing rule: "the only app I'm worried about is quotes and sks live.")
- Architecture: the Phase 2 cutover shipped per-tenant Supabase projects + a tenant routing layer (`shell_control.tenant_routing` + `getTenantDataClientById()`). That infrastructure already supports tenant-isolated Field data — Field just hasn't moved onto it yet.
- Strategy: **build in parallel, cut over deliberately** — identical playbook to the Cards mobile cutover (Phase 1.D / 2.B.6). The unified app is built and validated on a new Netlify deploy alongside SKS Labour. Only DNS flips at F3, in a maintenance window, with rollback as "do nothing — old app keeps working."

---

## Current state (2026-05-24)

### The three codebases (audit findings)

| Property | EQ Field demo | SKS NSW Labour |
|---|---|---|
| Repo | `C:\Projects\eq-solves-field` | `C:\Projects\sks-nsw-labour` |
| Deploy | `eq-solves-field.netlify.app` (branch `demo`) | `sks-nsw-labour.netlify.app` (branch `main`) |
| Version | v3.5.21 | v3.10.23 |
| Stack | Plain HTML/JS, Netlify Functions, Supabase Edge | Same |
| Supabase | `ktmjmdzqrogauaevbktn` (Field-specific, legacy) | `nspbmirochztcjijmcrx` (SKS-specific, legacy) |
| Diverged at | v3.5.0 (2026-05-20) | (same trunk until that date) |
| Tier system | Yes — `organisations.tier` + Wave 0–4 | No — single-tenant production |
| Melbourne-scale features | Yes (Projects, Forecast, Regions, Site Reports, Diary, Toolbox Talks) | No |
| Labour-hire features | No | Yes (Teams, Resource Allocation, Pipeline v3.4.85+, timesheet_locks, ts_apprentice_approval) |

### What's shared

Both apps descend from the same v3.4.x trunk. Common modules: `app-state.js`, `auth.js`, `supabase.js`, `utils.js`, `analytics.js`, `audit.js`, `leave.js`, `timesheets.js`, `people.js`, `managers.js`, `roster.js`, `sites.js`, `realtime.js`, `presence.js`. Common Netlify functions: `verify-pin.js`, `send-email.js`, `eq-agent.js`, `approve-leave.js`.

Both schemas overlap heavily with the per-tenant `app_data` we built in Phase 2 — staff, sites, schedule_entries, leave_requests, leave_balances, timesheets, prestart_checks, toolbox_talks, swms, jsa_records, itp_records, incidents, tenders are all already present in both `eq-canonical-internal` and `sks-canonical`. The Field-specific Supabases are duplicates of what the data plane already supports.

### What's unique to SKS Labour

Tables not yet in the per-tenant data plane:
- `teams` + `team_members` (roster filter groups for site-level work teams)
- `timesheet_locks` (per-org per-week locks for accountant review)
- `apprentice_approval_log` (audit trail for `ts_apprentice_approval` RPC)
- The Pipeline v3.4.85 tables (newer than EQ's Pipeline)

UI modules not in EQ:
- `teams.js`, `pipeline.js`, `pipeline-import.js`, `pipeline-resource.js`

### What's unique to EQ Field

Tables already in the per-tenant data plane:
- `projects` + `project_targets` (Wave 1–2)
- `regions` (Wave 4)
- `site_reports`, `diaries`, `toolbox_talks` (v3.4.79+)
- `apprentice_profiles` + `skills_ratings` + `quarterly_reviews` + `engagement_logs`
- `organisations.tier`, `organisations.is_seed_demo`, `people.role` enum (legacy field-specific Supabase only)

UI modules:
- `projects.js`, `forecast.js`, `regions.js`, `region-filter.js`, `flags.js`, `permission-matrix.js`, `apprentice-widget.js`, `project-hours.js`, `site-reports.js`, `home.js` (v3.5.0 mobile-first), `whatsnew`, `lazy-loader`

---

## End state

```
core.eq.solutions/
  ├── eq/field/    →  unified app, tier='standard'  (EQ tenant)
  ├── sks/field/   →  unified app, tier='enterprise' (SKS, post-cutover)
  └── <new>/field/ →  unified app, tier per `shell_control.tenants.tier`
```

- **One codebase**, deployed once. Branch off `eq-solves-field` (the cleaner / tier-aware base) → `unified-tenant` branch → eventually `main`.
- **One data plane**: each tenant's Field data lives on their per-tenant Supabase (`eq-canonical-internal`, `sks-canonical`, future tenants). The legacy Field-specific Supabases (`ktmjmdzqrogauaevbktn`, `nspbmirochztcjijmcrx`) are decommissioned after cutover.
- **Tier-gated features**: `tier='standard'` ships the basic Roster + Timesheets + Leave. `'advanced'` adds Projects + Apprentice modules. `'enterprise'` adds Forecast + Regions + Teams + Resource Allocation + Pipeline + timesheet locks.
- **Shell-mounted**: Field appears as an iframe at `/:tenant/field` in eq-shell (same pattern as Cards / Service today), inheriting the `eq_shell_session` cookie + tenant context.

---

## Staged plan

Five stages — first three are build-only with zero SKS prod impact. Cut-over (F3) is the single moment of real risk and is bounded to a maintenance window.

### F1 — Skeleton + tenant routing wiring (build only, ~1 sprint)

Concrete deliverables:

1. **New branch** `unified-tenant` on `eq-solves-field` (do NOT touch `main` or `demo`).
2. **Refactor `scripts/app-state.js`** — read tenant slug from URL path (`/<tenant>/field/...`) instead of from hostname-based detection. Keep hostname fallback for legacy deploys.
3. **Refactor `scripts/supabase.js`** — instead of hardcoded `TENANT_SUPABASE.eq` / `.sks`, call `GET /.netlify/functions/field-tenant-config?slug=<tenant>` which reads from `shell_control.tenant_routing` and returns the per-tenant Supabase URL + anon key. Caches per session.
4. **New Netlify function** `netlify/functions/field-tenant-config.ts` (eq-shell side) — session-authed, returns `{ supabase_url, supabase_anon_key, tier, features }` for the caller's tenant.
5. **Tier scaffolding port** — `scripts/flags.js`, `scripts/permissions.js`, `scripts/permission-matrix.js` from EQ Field stay as-is. Sidebar nav reads `TENANT.tier`.
6. **Schema migration** `supabase/tenant-migrations/0012_field_enterprise_extras.sql` — adds the SKS-only tables (`teams`, `team_members`, `timesheet_locks`, `apprentice_approval_log`, Pipeline v3.4.85+ tables) to the per-tenant baseline. Apply to both `eq-canonical-internal` and `sks-canonical` via MCP. Idempotent — uses `IF NOT EXISTS` so re-runs are safe.
7. **Port SKS-only UI modules** as stubs behind `tier='enterprise'` gate: `teams.js`, `pipeline.js`, `pipeline-import.js`, `pipeline-resource.js`. Initial port can be lift-and-shift; refinement in F2.
8. **New Netlify project** `eq-field-unified.netlify.app` — autoboot from `unified-tenant` branch. SKS users continue using `sks-nsw-labour.netlify.app` — untouched.

**Exit criteria for F1:**
- `eq-field-unified.netlify.app/eq/field` renders and works against `eq-canonical-internal` (the EQ tenant's data plane already populated by Phase 1.D sync).
- `eq-field-unified.netlify.app/sks/field` renders but data is empty (sks-canonical doesn't yet hold Field data — that's F2).
- Build clean, tests pass, no console errors.
- SKS Labour prod is verifiably untouched.

### F2 — Shadow data sync + parity QA (build only, ~1 sprint)

1. **Field data sync script** `scripts/sync-field-app-to-canonical.mjs` — pulls from the Field-specific Supabases and pushes to the per-tenant data plane:
   - `ktmjmdzqrogauaevbktn` (EQ Field) → `eq-canonical-internal`
   - `nspbmirochztcjijmcrx` (SKS Labour) → `sks-canonical`
   - Same pattern as existing `sync-tenant-data.mjs` (Phase 1.D)
2. **Hourly cron** (Supabase Edge Function or GitHub Action) running the sync. SKS Labour keeps writing to its legacy Supabase as today; the unified app reads a near-real-time shadow copy from `sks-canonical`.
3. **Operator-only QA access** — `eq-field-unified.netlify.app/sks/field` accessible only to Royce + Emma + dev accounts via a PIN gate or beta-access flag. SKS supervisors do NOT see it yet.
4. **Walk every screen** in the unified app for both tenants. Find divergences, fix in the unified codebase, iterate.
5. **Feature reconciliation** — for any SKS-only feature still incomplete, finish the port. For any EQ-only feature SKS shouldn't see, verify the tier gate works.

**Exit criteria for F2:**
- Unified app passes a full feature walkthrough for both `eq` and `sks` tenants, with the right tier behaviour.
- Sentry clean for 7 consecutive days on `eq-field-unified.netlify.app`.
- No Field functionality regression from SKS NSW Labour reachable in the unified app for `sks` tenant.

### F3 — Cut-over (the single moment of real risk)

1. **Maintenance window** scheduled with SKS users (60 min, off-peak Friday evening).
2. **SKS Labour goes read-only** — set a feature flag in `sks-nsw-labour` that disables all writes (forms, edits, approvals). Display a banner: "Maintenance in progress until X:XX."
3. **Final sync** `nspbmirochztcjijmcrx` → `sks-canonical` via `scripts/sync-field-app-to-canonical.mjs --slug=sks --final`.
4. **DNS swap** — `sks-nsw-labour.netlify.app` either redirects to `core.eq.solutions/sks/field` (cleanest), or its Netlify config points at the unified build (faster). Recommended: redirect, so the domain history clearly shows the cutover.
5. **Sentry watch** for 48h. Any P0 / P1 issue → rollback (DNS revert to old Netlify deploy + re-enable writes on old Supabase).
6. **7 days clean** → decommission `nspbmirochztcjijmcrx` Supabase project.

**Rollback path during F3:**
- DNS revert (instant — `sks-nsw-labour.netlify.app` back to old config).
- Re-enable writes on legacy Supabase.
- Lose any writes that landed on `sks-canonical` during the cutover window (small, since writes were disabled — only post-cutover changes).
- Investigate + retry later.

### F4 — Decommission EQ Field demo + advanced (build only, ~1 sprint)

1. After SKS is stable on the unified app, the same model applies to EQ tenant.
2. Migrate `ktmjmdzqrogauaevbktn` (EQ Field Supabase) → `eq-canonical-internal` (much smaller dataset; EQ demo + Melbourne trial).
3. Cut `eq-solves-field.netlify.app/demo` → `core.eq.solutions/eq/field`.
4. Decommission `eq-solves-field.netlify.app` and `ktmjmdzqrogauaevbktn`.

### F5 — Vendor / consolidate into eq-shell monorepo (optional)

1. If the unified app proves stable, consider moving its source into eq-shell as a vendored package (same pattern as `eq-intake`).
2. Pros: single deployment pipeline, atomic releases across Shell + Field + Cards + Intake.
3. Cons: build-time coupling — a Field bug breaks the Shell deploy.
4. Defer this decision to post-F4.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| SKS NSW Labour breaks during F1/F2 | 🔴 Critical | Build-only stages don't touch SKS Labour. Cut-over is F3-only, in a maintenance window, with instant DNS-revert rollback. |
| Data divergence between legacy SKS Supabase and `sks-canonical` during F2 | 🟡 Medium | Hourly sync + read-only QA access. Operators cannot accidentally write into the shadow copy during F2. |
| SKS-unique features (Teams / Pipeline / Resource Allocation) don't behave identically in unified app | 🟡 Medium | F2 parity QA walks every screen. Any divergence is a bug to fix in unified codebase before F3. |
| Tier-gating regressions hide features that should be visible to SKS | 🟡 Medium | Tier-flag matrix documented + tested. SKS = `enterprise` → all features visible. Defaults err on visible side; missing feature is the alarming case. |
| Schema drift between `eq-canonical-internal` and `sks-canonical` accumulates | 🟢 Low | 0012 migration applies to both via MCP in the same change. Future Field migrations go in `supabase/tenant-migrations/` (same folder Phase 2 used). |
| Per-tenant data-plane RPCs don't yet cover Field-specific operations | 🟢 Low | Most Field reads are SELECT against `app_data` tables — already work via the tenant client. Bespoke RPCs (e.g. `apply_leave_request`) port as-is into per-tenant migrations. |
| EQ Field demo data not yet in `eq-canonical-internal` | 🟢 Low | F1 syncs it once; F2 keeps it in sync. EQ Field demo is non-prod so this is low-stakes. |
| Cut-over window data loss (writes during the gap) | 🟡 Medium | SKS goes read-only at start of window. Window scoped to <60 min. Final sync runs after writes stop. |

---

## Cut-over runbook (F3 — execute when ready)

Pre-flight:
- [ ] F2 exit criteria all met
- [ ] Maintenance window communicated to SKS users 48h+ in advance
- [ ] Sentry alerts armed
- [ ] DNS rollback procedure tested in advance (do a dry-run to a staging domain)
- [ ] `sync-field-app-to-canonical.mjs --slug=sks --final` tested in dry-run mode

Window (target 60 min, expect 30):
1. T+0:00 — Flip SKS Labour read-only flag. Display maintenance banner.
2. T+0:05 — Run final sync `sks-nsw-labour Supabase → sks-canonical`. Verify row counts match.
3. T+0:15 — DNS swap `sks-nsw-labour.netlify.app` → `core.eq.solutions/sks/field` (or unified Netlify config).
4. T+0:20 — Smoke: sign-in as a known supervisor, walk: open roster, edit a cell, submit a timesheet, approve a leave request, open Teams, open Resource Allocation.
5. T+0:30 — Remove maintenance banner. Notify users.
6. T+0:30 → T+48h — Watch Sentry. Any P0/P1 → rollback (DNS revert, re-enable old writes).

Post-window:
- 7 days clean → decommission `nspbmirochztcjijmcrx` Supabase project (snapshot first).

---

## Open decisions

1. **Where does the unified codebase live?**
   - Option A: `unified-tenant` branch on `eq-solves-field` → eventually merge to `main`.
   - Option B: brand-new repo `eq-field-unified`.
   - Option C: vendor into eq-shell as a package (defer to F5).
   - **Recommended: A** (uses existing tier scaffolding, lowest setup cost).

2. **What about the EQ Field demo (`eq-solves-field.netlify.app`)?**
   - Stays running through F1–F3 as today, then decommissioned in F4.

3. **Pipeline version reconciliation** — EQ has v3.4.79 Pipeline, SKS has v3.4.85+ with additional features. Which wins in the unified app?
   - **Recommended: SKS's v3.4.85+** (more features, production-tested).

4. **Per-tenant Field RPCs** — Field has several RPCs (`apply_leave_request`, `submit_timesheet`, etc.) that currently exist on the Field-specific Supabases. Port them into per-tenant migrations as part of 0012?
   - **Recommended: yes**, as part of F1 schema work. Skipping them means F2 reads work but writes fail.

5. **`organisations` / `people.role` enum / `is_seed_demo`** — these schemas exist on the EQ Field Supabase only. Add to per-tenant baseline?
   - **Recommended: yes** for `people.role` enum (used by Wave 4 RLS). `organisations.tier` moves to `shell_control.tenants.tier` (it's tenant metadata, belongs on the control plane).

6. **Auth model** — EQ Field uses PIN-based STAFF_CODE/MANAGER_CODE. Shell uses email + PIN with `eq_shell_session` cookie. Unify?
   - **Decision needed.** Cleanest is to migrate Field to the Shell auth model (Shell mints the Supabase JWT, Field consumes it). But that's invasive and could affect SKS supervisor workflows.
   - **Recommended: defer to F4+** — F1/F2/F3 use the existing per-tenant routing, Field can keep PIN auth internally, Shell session is only required for the iframe handshake.

---

## What this plan is NOT

- Not a rewrite. EQ Field stays the base; SKS-unique features port into it. No new framework, no bundler change.
- Not a same-day cutover. F1+F2 measured in sprints. F3 is the single-window cutover.
- Not unconditional commitment to F4/F5. If F3 succeeds and the unified app proves stable, F4 follows. F5 is an optional optimisation that can wait years.

---

## Pre-flight before starting F1

- [ ] Royce approval of this plan (or pushback / edits)
- [ ] Decision on Open Decisions 1, 3, 5, 6 above (the rest are recommended defaults)
- [ ] Confirm SKS maintenance windows are acceptable to SKS users (proactive notice)
- [ ] Spin up `eq-field-unified.netlify.app` placeholder so DNS is available when F1 ships
