# EQ Service ⇄ EQ Shell + EQ Intake — integration plan

Date: 2026-05-19. Status: draft, supersedes [PR #151](https://github.com/Milmlow/eq-solves-service/pull/151) for the long-term shape (PR #151 stays valid as the short-term bridge).

## TL;DR

After reading [`C:/Projects/eq-intake/EQ-TENANCY-MODEL.md`](../../C:/Projects/eq-intake/EQ-TENANCY-MODEL.md) (locked 2026-05-18), the master plan for the EQ platform is sharper than the [#151 proposal](https://github.com/Milmlow/eq-solves-service/pull/151) assumed:

- **Per-tenant Supabase project** (not shared DB + RLS). SKS canonical = one Supabase project. Future Tenant Y = its own.
- **EQ Shell** is a single React app that mounts modules (Cards / Intake / Quotes / Service / Field) as **lazy-loaded routes**.
- **All modules point at the same tenant's Supabase.** No cross-module data plumbing — they share the database.
- **`@eq/schemas`** is the canonical type / SQL-codegen layer. Every module reads/writes the same canonical entities.
- **EQ Intake** owns all bulk imports via the `eq_intake_commit_batch` RPC. Modules consume intake-committed data.

This rewrites the integration story for EQ Service. The journey is **three phases**, not two:

| Phase | What happens | When |
|---|---|---|
| **1 — Bridge** | Service stays at its own Supabase + Netlify. EQ Shell mints a 60s HMAC token; Service's new `/auth/shell-bridge` route validates it and signs the user into Service's Supabase Auth (the auth-share + redirect option locked in PR #151). | Pre-launch, weeks |
| **2 — Canonical migration** | Service migrates onto SKS canonical Supabase (the same project that holds Cards / Intake / Quotes data). Drop the dedicated `urjhmkhbgaxrofurpbgc` project after a verification window. | Months 1-2 post-launch |
| **3 — Port into shell** | Service becomes a `@eq/service` package inside `eq-platform/`, lazy-loaded as a route in the shell. Stops being a Next.js standalone Netlify deployment. | Months 3-6 |

Phase 1 is **what PR #151 unblocks**. Phases 2 + 3 are this doc's contribution — they tie Service into the canonical layer per the master plan.

## The bigger picture — what we're plugging into

Recap of `EQ-TENANCY-MODEL.md` (read that doc first if you haven't):

```
┌────────────────────────────────────────────────────────────────┐
│   ONE canonical Supabase project — PER TENANT (SKS, then Y…)   │
│                                                                │
│   Platform tables (cross-module):                              │
│     eq_schema_registry  eq_intake_events  eq_intake_row_audit  │
│     eq_intake_templates eq_export_events eq_export_profiles    │
│                                                                │
│   Canonical entity tables (generated from @eq/schemas):        │
│     staff  customer  contact  site  asset  swms  prestart …   │
│                                                                │
│   Supabase Auth (per-tenant user pool)                         │
│   RLS — role-within-tenant (not cross-tenant; tenants are      │
│         already physically separated by being in different     │
│         Supabase projects)                                     │
└───────┬─────────────┬─────────────┬─────────────┬──────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
    EQ Field      EQ Service    EQ Intake     EQ Quotes
    (mobile)      (work orders) (in/out)      (quoting)
    ──────        ──────        ──────        ──────
       Each module = a frontend package (Vite/React).
       ALL point at the SAME tenant's Supabase.
       Each module owns a SURFACE, not data.
       All share @eq/schemas + @eq/validation + @eq/confirm-ui.
```

**Key implications for EQ Service:**

1. **Service's "own" Supabase project (`urjhmkhbgaxrofurpbgc`) is a transitional artefact.** The target state has Service reading/writing from the SKS canonical (and Jemena canonical, when Jemena becomes a tenant in their own right rather than a customer-of-SKS).
2. **Service's entity tables overlap with the canonical schema.** `customers`, `sites`, `assets`, `job_plans`, `maintenance_checks` etc. — these need to align with `@eq/schemas` or be promoted into it.
3. **Service's RLS becomes role-within-tenant only.** Cross-tenant isolation is physical (different Supabase project). The `tenant_id` column on every Service table becomes redundant once it's in a tenant-specific project (single-tenant within that DB by definition).
4. **Service's auth becomes shared with the rest of the shell.** Today Service uses Supabase Auth with email + password + TOTP MFA. Future: shell handles email + PIN sign-in, Service either accepts the shell's session (Phase 1 bridge) or migrates to the same auth mechanism (Phase 3 port).
5. **Service's import flows compete with EQ Intake.** Today: `/maintenance/import` (Maximo Delta), `/testing/rcd/import` (Jemena RCD xlsx). Future: those become Intake importers; Service reads the committed data.

## Where Service is today

| Concern | Current state | Phase 2 target | Phase 3 target |
|---|---|---|---|
| Backend | Own Supabase (`urjhmkhbgaxrofurpbgc`) | SKS canonical | SKS canonical |
| Frontend | Standalone Next.js on Netlify (`eq-solves-service.netlify.app`) | Same | Lazy module inside `@eq/shell` |
| Auth | Supabase Auth + TOTP MFA | Same as shell (PIN or Supabase session) | Same as shell |
| Schema | Service-specific tables (`maintenance_checks` kind discriminator etc.) | Mapped into `@eq/schemas` or promoted | Promoted |
| Imports | In-app (Maximo Delta, Jemena RCD) | Intake-owned | Intake-owned |
| Branding | `tenant_settings` table per tenant | Inherited from shell config | Inherited from shell config |
| Tenant isolation | RLS via `tenant_id` columns | Physical (own DB) — `tenant_id` becomes redundant | Same |
| Module entitlements | `tenants.tier` column (Phase A landed) | `eq-shell-control.module_entitlements` | Same |

## Phase 1 — Bridge (now, what PR #151 unblocks)

**Goal:** SKS users sign into the shell once and reach Service without re-authenticating.

**Shape:**
- Shell handles sign-in (email + PIN per the EQ-TENANCY-MODEL design; or email + Supabase password — see open decisions).
- Shell mints a **60s HMAC token** carrying `{user_email, tenant_slug, role, exp}`.
- Service exposes `/auth/shell-bridge?token=…` (new route).
- The route validates the HMAC signature + freshness, then either:
  - Uses Supabase admin client's magic-link flow to create a session (PR #151's Option B), or
  - Looks up the user in Service's existing `auth.users` and mints a Supabase session directly via the admin API.
- User lands on `/dashboard` already signed in. Service's existing Supabase Auth flow is untouched for direct-URL access.

**Cost:** ~360 LOC across ~5 files (per PR #151's estimate). One new env var (`EQ_SECRET_SALT` shared with shell). Auth-flow change — needs explicit chat OK before code per AGENTS.md.

**What Phase 1 doesn't solve:**
- The two Supabase projects still hold separate data (Service in `urjhmkhbgaxrofurpbgc`, shell-control in `eq-shell-control`). Users may exist in both, with different UUIDs. The bridge token carries `email` as the identity key — not UUID — to avoid mapping pain.
- Each module still has its own auth surface (Service's signin page, shell's signin page). Direct-URL traffic to `eq-solves-service.netlify.app` continues to work standalone; the bridge is opt-in.
- MFA tension persists. Shell uses PIN; Service requires Supabase AAL2 TOTP. PR #151's recommendation: accept the double-prompt rather than weaken Service. Stage 1 admins / supervisors who land via the shell still see Service's MFA challenge on first session.

## Phase 2 — Canonical migration (months 1-2 post-launch)

**Goal:** Service stops running its own Supabase. Data lives in SKS canonical alongside Cards / Intake / Quotes.

**Sequence:**

1. **Schema alignment.** Map every Service-specific table to a `@eq/schemas` entity:
   - `customers` → already in `@eq/schemas` (Intake demo has it). One-time check that Service's columns are a subset / superset of the canonical.
   - `sites` → same.
   - `assets` → same.
   - `job_plans` + `job_plan_items` → **promote** to `@eq/schemas` (Service-originated; doesn't exist there yet).
   - `maintenance_checks` + `maintenance_check_items` → promote.
   - `check_assets` → promote.
   - `acb_tests` / `nsx_tests` / `rcd_tests` + circuits → promote.
   - `defects` → promote.
   - `attachments` → may already exist in canonical (compliance artefacts shared with Field).
   - `tenant_settings` → does NOT promote. Becomes per-tenant config in shell env vars + module-specific tables.

2. **Migration script.** One-time SQL that:
   - Creates the new tables in SKS canonical (or applies the `@eq/schemas` codegen).
   - Copies data from `urjhmkhbgaxrofurpbgc` → SKS canonical.
   - Preserves IDs (UUIDs survive the move).
   - Resolves auth.users by email (Service `auth.users` IDs differ from canonical's; remap `created_by` / `assigned_to` / `tested_by` / `technician_user_id` / `raised_by`).

3. **Repoint the Next.js app.** Update Service's env vars to the canonical's URL + service-role key. Deploy.

4. **Verification window.** Run both Supabases in parallel (Service writes to canonical, Service also writes to old project as a shadow) for ~1 week. Then disconnect the old.

5. **Decommission.** Deprecate `urjhmkhbgaxrofurpbgc`. Keep a backup.

**Cost:** large, careful operation. ~1 week of work + 1 week of verification. Out-of-hours cutover window for the actual data move.

**What Phase 2 doesn't solve:**
- Service is still a standalone Next.js deployment. The shell still iframes / redirects in (Phase 1 bridge persists).
- Service's auth UI is still separate from the shell's.

## Phase 3 — Port into shell (months 3-6)

**Goal:** Service becomes `@eq/service` — a buildable React package inside `eq-platform/packages/`, lazy-loaded as a route in the shell.

**Shape:**
- Service's pages (everything under `app/(app)/*`) become React components inside `@eq/service/src/`.
- The Next.js server-action pattern goes away. Replaced with direct Supabase client calls (the same pattern Cards / Intake use today) OR small Netlify functions if heavy server-side work is needed (PDF rendering, etc.).
- Service's routes mount under `<shell-domain>/service/*`. Sub-routes (`/service/maintenance/[id]`, `/service/testing/acb/[testId]`) preserved by the shell's React Router config.
- Branding, auth, tenant config — all inherited from the shell. Service stops shipping its own `tenant_settings` flow.

**Cost:** 4-6 weeks. Significant — but the canonical migration in Phase 2 derisks most of the data shape. The remaining work is reshape the Next.js code into a Vite-buildable package + drop server actions in favour of client calls.

**Why bother:**
- One auth surface across all EQ modules.
- One deploy artefact (the shell). New tenant = new env vars, not new Netlify project.
- Service shares ALL the platform helpers (`@eq/validation`, `@eq/confirm-ui`, etc.).
- Per-tenant branding works for free.

## EQ Intake integration — three matching phases

Intake follows the same arc, slightly offset:

| Phase | What | When |
|---|---|---|
| **1 — Status quo** | Service keeps its in-app importers (`/maintenance/import` for Maximo Delta WO, `/testing/rcd/import` for Jemena RCD xlsx). Intake handles new imports (SimPRO customers/sites, MYOB, etc.). | Now — pre-launch |
| **2 — Migrate Service importers to Intake** | Build Intake schemas for Delta WO + RCD xlsx (same `@eq/schemas` pattern). Service's importers become "view-only" — admins point at Intake's UI for new imports. Existing imports keep working. | After Phase 2 canonical migration |
| **3 — Decommission Service importers** | Remove the import routes from Service entirely. All bulk-create flows go through Intake. Service consumes intake-committed canonical data. | After Phase 3 shell port (or earlier if Intake schemas land first) |

**Why Intake owns all imports** (per the existing memory `project_eq_intake_owns_imports.md`):

- Intake's `eq_intake_commit_batch` RPC handles validation, dedup, audit, and entity-resolution (customer name → customer_id) once. Service's in-app importers each re-implement those concerns.
- Intake's confirm-UI is a generic spreadsheet-style preview/edit surface. Building per-format previews inside Service (Jemena's multi-tab RCD xlsx, for instance) is bespoke code that doesn't compose.
- Intake's audit trail (`eq_intake_events` + `eq_intake_row_audit`) gives compliance evidence per import. Service's importers log via `audit_logs` separately.

**What Intake does NOT replace:**
- Service-specific operational creation (creating a single maintenance check from `/maintenance` — that's a UI flow, not bulk import).
- The `propagateCheckCompletionIfReady` propagation logic (cross-table state machine, not import).
- Test-workflow saves (Step 1/2/3 ACB / NSX saves, RCD circuit edits).

These stay in Service even after Phase 3.

## Sequence + dependencies

```
Today                                                    Phase 3
─────                                                    ───────

[Service standalone]                                     [Service-in-shell]
   urjhmkhbgaxrofurpbgc                                  SKS canonical
   own auth                                              shell auth
   own importers                                         intake importers
   Netlify standalone                                    @eq/service package
        │                                                       ▲
        │ PR #151 Option B bridge ──────────┐                   │
        │                                   │                   │
        ▼                                   │                   │
[Phase 1 — bridge]                          │                   │
   /auth/shell-bridge accepts shell token ──┘                   │
   shell mints, Service signs in                                │
        │                                                       │
        │ schema alignment + data migration                     │
        ▼                                                       │
[Phase 2 — canonical migration]                                 │
   data moves to SKS canonical                                  │
   Service env points at canonical                              │
   urjhmkhbgaxrofurpbgc decommissioned                          │
        │                                                       │
        │ port Next.js → Vite package                           │
        ▼                                                       │
[Phase 3 — shell port] ─────────────────────────────────────────┘
   @eq/service mounts inside shell
   one deploy, one auth, one branding flow
```

**Hard prerequisites:**
- Phase 1 needs `@eq/schemas`-aligned tables on the SKS canonical (already in flight per EQ-TENANCY-MODEL). Independent of Service's own work.
- Phase 2 cannot start until SKS canonical exists in production AND a clean migration script is rehearsed against a staging copy.
- Phase 3 cannot start until Phase 2 is verified stable for ≥30 days.

**Soft prerequisites (could re-sequence with care):**
- Intake importers for Delta WO + RCD xlsx don't strictly block Phase 2 — Service can keep its importers writing into canonical. But Phase 3 wants them gone (the lazy-loaded Service module shouldn't ship importer code that Intake already has).

## Open decisions for Royce

These need explicit calls before Phase 1 code lands:

1. **Bridge auth mechanism** — Phase 1's auth-share takes the **email** as the user identity (per PR #151's recommendation). Confirm: that's the canonical key, not UUID. Magic-link flow OK?
2. **MFA tension** — Phase 1 still requires Supabase TOTP on Service even when shell sign-in is PIN. Accept the double prompt (recommendation per PR #151) or relax?
3. **Phase 2 timing** — start Phase 2 work as soon as eq-service is launched + stable for 30d? Or wait until the first non-SKS customer signs up and forces it?
4. **Phase 3 trigger** — what's the signal? Customer count? Specific feature requests that benefit from cross-module data (e.g. "Cards + Service in one report")? Or a calendar event?
5. **Intake migration cost vs benefit** — Service's existing importers work well today. Migrating them to Intake is a Phase 2-or-3 lift with no user-visible benefit during the transition. Acceptable to defer indefinitely? Or fix a date?

## What this means for PR #151

PR #151's recommendation (Option B — auth-share + redirect via `/auth/shell-bridge`) is **still correct** for Phase 1. This doc extends it with:

- **Don't treat Phase 1 as the destination.** It's a bridge. The destination is Phase 3 — Service as a lazy module inside the shell.
- **Don't invest in user-identity mapping infrastructure beyond email.** Phase 2 collapses both auth pools into one, so mapping tables would be throwaway.
- **The "user identity mapping" open question in PR #151** (which proposed `(tenant.slug, user.email)` as the canonical key) is the same as Phase 1's decision #1 above. They're the same question.
- **MFA tension** in PR #151 also persists into this doc's decision #2.

PR #151 doesn't need to be revised — it's a valid Phase 1 spec. This doc layers Phases 2 + 3 on top.

## Cross-references

- [`C:/Projects/eq-intake/EQ-TENANCY-MODEL.md`](../../C:/Projects/eq-intake/EQ-TENANCY-MODEL.md) — master plan. Read first.
- [`C:/Projects/eq-intake/EQ-AS-CONDUIT.md`](../../C:/Projects/eq-intake/EQ-AS-CONDUIT.md) — Intake's "why" (referenced from EQ-TENANCY-MODEL).
- [`C:/Projects/eq-context/eq/products.md`](../../C:/Projects/eq-context/eq/products.md) — current state of each EQ product.
- [PR #151 — EQ Shell integration proposal for EQ Service](https://github.com/Milmlow/eq-solves-service/pull/151) — Phase 1 spec.
- [Memory: `project_eq_intake_owns_imports.md`](../../C:/Users/EQ/.claude/projects/C--Projects-eq-solves-service/memory/project_eq_intake_owns_imports.md) — locked decision that EQ Intake owns all bulk imports.
- [Memory: `project_shell_integration_option_b.md`](../../C:/Users/EQ/.claude/projects/C--Projects-eq-solves-service/memory/project_shell_integration_option_b.md) — Phase 1 locked decision.

## Status

Draft. Living doc — update `last_updated:` when phases land or sequence changes. Companion to [`docs/architecture/2026-05-19-user-journey-progression.md`](2026-05-19-user-journey-progression.md): journey doc covers user-facing surfaces; this doc covers the platform substrate.
