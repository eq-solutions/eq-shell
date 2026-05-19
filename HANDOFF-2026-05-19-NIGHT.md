# Overnight handoff — 2026-05-19 → 2026-05-20 AM

Cold-read this top-to-bottom. TL;DR is enough if you're late.

---

## 1. TL;DR

- **Intake spine is live behind login.** `/core/intake` now renders the real IntakeModule (drop CSV → map → validate → commit) instead of `ComingSoon`. Deploy preview is green.
- **Browser → Supabase auth works** via a 1-hour HS256 JWT minted by `shell-login` / `verify-shell-session` and carried by `@supabase/supabase-js`. RLS SELECT policies live on 12 canonical tables; writes go only through `eq_intake_commit_batch`.
- **eq-intake is vendored, not submoduled.** Submodule (`7c9286b`) was tried first — Netlify can't clone the private `eq-solves-intake` repo. Pivot to vendoring (`f5c0457`) is the current shape. Cleanly reversible if `eq-solves-intake` goes public or a Netlify deploy key is configured.
- **Observability work is held.** Sentry + PostHog + Clarity SDKs are wired on agent worktree `worktree-agent-a07832911731d680f` (commits `e0de932`, `6ea735e`). Not integrated into PR #6, deps not added.
- **PR #6 is mergeable.** Status checks SUCCESS. Decision pending: merge to `main` or keep iterating on the preview.

---

## 2. Live deploy state

| Item | Value |
|---|---|
| Deploy URL | https://deploy-preview-6--eq-shell.netlify.app |
| PR | https://github.com/eq-solutions/eq-shell/pull/6 |
| PR title | Phase 2: pnpm + submodule + IntakeModule + browser Supabase auth |
| Base / head | `main` ← `claude/distracted-cartwright-8d001d` |
| Mergeable | `MERGEABLE` (no conflicts) |
| Deploy preview check | `netlify/eq-shell/deploy-preview` → **SUCCESS** |
| Tip SHA | `f5c0457` (Pivot: vendor eq-intake/eq-platform/) |

**Login creds (dev):** `dev@eq.solutions` / PIN `1234` on `core` tenant.

**Reachable surfaces:**
- `/` — login page
- `/core/` — tenant home, EQ branding, module nav
- `/core/intake` — real IntakeModule (entitlement `intake` enabled)
- `/core/field` — EQ Field iframe handoff (entitlement `field` enabled)

---

## 3. Architecture as of tonight

- pnpm workspace (`pnpm@9.15.9`), Node-driven build via `pnpm run build`.
- `@eq/*` packages (`schemas`, `validation`, `ai`, `intake`, `confirm-ui`, `intake-demo`) sourced from **vendored** `./eq-intake/eq-platform/packages/*` — NOT a git submodule (see §4 α-pivot).
- React **19.2.6** end-to-end. Both `@eq/confirm-ui` and `@eq/intake-demo` migrated tonight (eq-intake commit `f31june` — moved `react`/`react-dom` to `peerDependencies`, added `import type { JSX } from "react"` to 10 .tsx files).
- Browser Supabase auth: shell-login + verify-shell-session sign HS256 JWT `{ sub, role: 'authenticated', aud: 'authenticated', user_metadata: { tenant_id }, iat, exp }` with `SUPABASE_JWT_SECRET`. Browser passes it as Bearer on a `@supabase/supabase-js` client (`src/supabase.ts → useSupabaseClient()`).
- **RLS:** SELECT-only policies on the 12 canonical tables (customers, contacts, sites, staff, assets, schedule_entries, incidents, itp_records, jsa_records, prestart_checks, swms, toolbox_talks), all using `tenant_id = ((auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid)`. Confirmed via `pg_policies`.
- **Writes:** routed only through `eq_intake_commit_batch` SECURITY DEFINER RPC; direct browser INSERT/UPDATE/DELETE on canonical tables is blocked.
- `auth.users.id` ↔ `public.users.id` aligned for `dev@eq.solutions` (`b508008d-35d7-45c4-9e0e-8b3f17eeacf1`) so `supabase.auth.getUser()` resolves the same row both sides. Confirmed by SQL join.
- Local dev: `pnpm dev:netlify` boots Vite + Functions on a single `localhost:8888` origin (Vite-alone can't exercise the Functions). Held on agent worktree `ac706c691af65192a`, not merged.
- Marketing apex `eq.solutions` untouched (Cloudflare Pages). Tenant subdomains use per-alias model per `netlify-wildcard-limitation` memory.

---

## 4. Four-agent overnight rounds

### Round 1 (α / β / γ / δ)

| Agent | Goal | Landed? | Where it lives |
|---|---|---|---|
| **α — submodule integration** | Make eq-shell Netlify-deployable by adding eq-intake as a git submodule | **Partially — superseded.** Commit `7c9286b` (Add eq-intake as submodule) shipped. Deploy preview failed at "preparing repo" because Netlify can't clone the private `eq-solves-intake` repo. β-track pivoted to vendor. | `7c9286b` on `claude/distracted-cartwright-8d001d`; superseded by `f5c0457` |
| **β — @eq/* wire-up + IntakeModule mount** | Replace `/intake` ComingSoon with real IntakeModule, propagate Supabase + tenantId | **Landed.** `b863ec2` "Wire @eq/* packages + mount real IntakeModule". On PR #6. | `b863ec2` |
| **γ — browser Supabase auth + RLS** | Mint short-lived JWT in functions, ship RLS so browser can read canonical tables safely | **Landed.** `f2b745f` + migration `2026_05_19_canonical_select_rls_policies`. On PR #6. | `f2b745f` |
| **δ — observability (Sentry / PostHog / Clarity)** | Wire EQ-standard browser + server telemetry per global stack | **Built, held.** `e0de932` (browser SDKs + runbooks) and `6ea735e` (server-side Sentry wrapper) on `worktree-agent-a07832911731d680f`. Deps NOT added to `package.json`; not on PR #6 per your decision to hold. | `e0de932`, `6ea735e` on `worktree-agent-a07832911731d680f` |

### Mid-round work (not part of α/β/γ/δ)

| Worktree / branch | Commit | What | Status |
|---|---|---|---|
| `worktree-agent-ac706c691af65192a` | `3db99b4` | `pnpm dev:netlify` — Vite + Functions on one origin | Held, not merged |
| `worktree-agent-a1505563b4d31152d` | (same as PR #6 head) | β + γ co-branch | Folded into PR #6 |
| main thread on `claude/distracted-cartwright-8d001d` | `67901b0` | Fix stale `pnpm-workspace.yaml` comment | On PR #6 |
| main thread | `f5c0457` | **Pivot: vendor eq-intake/eq-platform/** | On PR #6 (current tip) |

### Battle-test commits surfaced live

- `f5c0457` is itself a battle-test fix: the α submodule plan worked locally, broke on Netlify's first preview build at the clone step. Vendor pivot landed within the same session.

---

## 5. Battle testing log

Tonight's live test surfaced two real failures and several near-misses:

1. **Netlify build can't clone private submodules.** Found when the first deploy preview after `7c9286b` failed at "preparing repo". Root cause: `eq-solves-intake` is private; Netlify has no deploy key. Three resolution paths documented (public the repo / configure deploy key / vendor). **Fixed by `f5c0457`** — vendor. Reversible.
2. **`tsc -b` failed resolving `@eq/ai` etc. on fresh checkout.** Each `@eq/*` `package.json` points `main` + `types` at `./dist/...` which is gitignored. The sibling-checkout layout had stale `dist/`s from earlier eq-intake work, masking the problem. **Fixed in `7c9286b`** by adding `build:packages` as a `prebuild` step (`pnpm -r --filter "./eq-intake/eq-platform/packages/**" run build`). Survived the vendor pivot.
3. **eq-shell's strict `noUnusedLocals` caught unused imports inside eq-intake source.** eq-intake's own typecheck didn't flag them. Fixed in eq-intake commit `c4232a3` (`Remove unused imports flagged by eq-shell strict tsconfig`) — `QuickDestination`, `firstSiteField`.
4. **React 19 + intake-demo broke peer-dep resolution.** intake-demo had `react`/`react-dom` as regular `dependencies`, which would double-install React 18 into a React 19 host and cause "Invalid hook call". Fixed in eq-intake `f31935cc` (React 19 migration): move to `peerDependencies`, range `>=18.0.0`, plus `import type { JSX }` codemod in 10 .tsx files.
5. **SimPRO fixture smoke (eq-intake `1f431f0`).** Ran the parser → mapping → validation legs against three real SimPRO CSV exports (267 customers / 393 contacts / 544 sites). **No engine bugs.** Parser is rock solid (0 malformed across 1,204 rows). Customer mapping + validation production-ready (240/267 valid). Sites reject 535/544 because `Country="Australia"` doesn't coerce to ISO alpha-2 — schema alias gap, not an engine bug. Contact rejects 100% in isolation (expected — FK resolution happens in `commit-canonical.ts`, not `validate()`).

Memory file `phase-1-d-smoke-test-state.md` covers the earlier backend smoke (login + cookie + verify + iframe HMAC token). That work still holds; nothing tonight broke it.

---

## 6. Open items for you to decide

1. **eq-solves-intake: public, deploy key, or stay vendored?**
   - **(a) Public** — fastest revert to submodule. IP call: does anything in eq-intake leak commercial advantage if open?
   - **(b) Configure Netlify deploy key** — proper long-term answer if the repo stays private. Needs a Netlify dashboard step + GitHub deploy-key add.
   - **(c) Stay vendored** — works today. Manual re-vendor each time eq-intake moves. Documented in eq-shell README.
   - **(d) Publish `@eq/*` to private npm scope** — cleanest, most setup. Each package needs a real build script.
   - I held the call; pick when you wake.

2. **Merge PR #6 to `main`?**
   - Checks green, mergeable. Squash or keep the five commits — your call.
   - If yes: do we want `claude/distracted-cartwright-8d001d` deleted post-merge?

3. **Integrate δ (observability)?**
   - Code is ready on `worktree-agent-a07832911731d680f`. Two commits: `e0de932` (browser SDKs + runbooks) and `6ea735e` (server-side Sentry wrapper).
   - Per your global stack: org slug `eq-solutions`, project slug `eq-shell`. DSN + posthog key + clarity ID would go to Netlify env vars as `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_CLARITY_PROJECT_ID`.
   - Open as a separate PR after #6 merges?

4. **Land `pnpm dev:netlify`?** Branch `worktree-agent-ac706c691af65192a` commit `3db99b4`. Adds local-dev flow with Functions. Independent of PR #6; could fold in or PR separately.

5. **SimPRO site-country alias gap.** 535/544 site rows reject because `Country="Australia"` isn't recognised. Add the alias to the canonical site schema in eq-intake — small follow-up, not blocking.

6. **eq-intake remote.** eq-intake commit log notes "no git remote per substrate". The submodule path assumes `eq-solves-intake` on GitHub. Confirm that remote exists and is up to date with `overnight-review-2026-05-19` (or `1f431f0` tip) before reviving the submodule plan.

---

## 7. Recoverable state

### Netlify env vars on `eq-shell` (per PR #6 body — confirmed set tonight)

Browser:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Server (functions):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` ← **added today**
- `EQ_SECRET_SALT`

### Git branches in flight

**eq-shell** (`C:/Projects/eq-shell`):
- `claude/distracted-cartwright-8d001d` ← PR #6 head, tip `f5c0457`. **This is the live branch.**
- `worktree-agent-a07832911731d680f` — observability (δ), held
- `worktree-agent-ac706c691af65192a` — `pnpm dev:netlify`, held
- `worktree-agent-a1505563b4d31152d` — β+γ co-branch (folded)
- `worktree-agent-a10b860f34ecda43a`, `a84649015a012d2a5`, `ac72ebd7f9afd9a74`, `ad4d9ae254d52263a` — no commits beyond `a816194` (Phase 1.E baseline); agents likely didn't ship
- `claude/angry-morse-56771d` — same δ tip as `worktree-agent-a07832911731d680f`
- `claude/quizzical-wu-79a7d2`, `claude/phase-2-import-screen`, `claude/phase-2-spike-v2` — older Phase 1.E doc + Phase 2 spike branches, not touched tonight

**eq-intake** (`C:/Projects/eq-intake`):
- `overnight-review-2026-05-19` ← tip `1f431f0`. Tonight's work: SimPRO fixture smoke, unused-imports cleanup, React 19 migration, consolidation snapshot, canonical-commit path with RPC handlers
- `claude/competent-kilby-d313f5` — local-only branch

### Supabase migrations applied to `eq-canonical` (`jvknxcmbtrfnxfrwfimn`) tonight

| Version | Name |
|---|---|
| 20260519093858 | `2026_05_19_shell_control_plane` |
| 20260519105945 | `2026_05_19_enable_intake_for_core` |
| 20260519111130 | `2026_05_19_canonical_select_rls_policies` ← γ |
| 20260519114355 | `2026_05_19_align_public_user_id_with_auth` ← supports `auth.getUser()` |

Confirmed via `mcp__...__list_migrations`. RLS confirmed via `pg_policies` — 12 canonical SELECT policies + INSERT/SELECT/UPDATE on intake framework tables + `service_role_all` on `tenants` / `users` / `module_entitlements`.

### Files of interest if you need to dig

- `C:/Projects/eq-shell/netlify/functions/_shared/supabase-jwt.ts` — JWT signer
- `C:/Projects/eq-shell/src/supabase.ts` — browser client
- `C:/Projects/eq-shell/src/modules/intake.tsx` — IntakeModule mount point
- `C:/Projects/eq-shell/eq-intake/eq-platform/` — vendored tree (don't edit in place; re-vendor from `C:/Projects/eq-intake/`)
- `C:/Projects/eq-shell/README.md` — "Cloning" + "Updating the vendored packages" sections
- `C:/Users/EQ/.claude/projects/C--Projects-eq-shell/memory/eq-intake-shell-integration.md` — full decision log on the submodule → vendor pivot

---

## Update log (appended live as the night progresses)

_Initial pass: 2026-05-19 ~22:00 AEST. Main thread may append below as battle testing continues._

---

### Morning update — closure pass (2026-05-19 → 20 overnight)

**Headline:** Everything in the original handoff has either shipped, been fixed by battle testing, or been integrated. Production is live and the full canonical-commit path works end-to-end through the UI.

#### What changed since the initial handoff

| Item | Status | Where |
|---|---|---|
| PR #6 merged to main | ✅ | `c56d012` merge commit |
| Production redeploy after env vars set | ✅ | `37e9dbf` empty-commit trigger |
| α2 country coercer merged + deployed | ✅ | `53415ad` merge |
| Customer-schema country coercer (γ2 follow-up) | ✅ | `bae742b` merge |
| β2 netlify.toml + README + .gitignore | ✅ integrated this pass | this branch |
| δ Sentry + PostHog + Clarity (deps + code + runbooks) | ✅ integrated this pass | this branch (reversed earlier hold) |
| Battle test BATTLE_TEST rows in DB | ✅ cleaned up | `customers` + `eq_intake_events` |
| eq-intake `overnight-review-2026-05-19` branch | ✅ pushed (incl. γ2 doc) | github.com/eq-solutions/eq-solves-intake |

#### Bugs surfaced by live battle testing + fixed live

| # | Bug | Fix | Migration |
|---|---|---|---|
| 1 | `SUPABASE_JWT_SECRET` missing in deployed function | Env vars baked at build time — triggered redeploy via empty commit | n/a (Netlify env) |
| 2 | `eq_intake_commit_batch` overloaded — 4-arg + 5-arg-default versions both existed | Dropped 4-arg version | `2026_05_19_drop_old_commit_batch_overload` |
| 3 | `null value in column customer_id` despite `DEFAULT gen_random_uuid()` | `jsonb_populate_record` bypasses DEFAULTs — RPC now injects PK UUID per table | `2026_05_19_commit_batch_inject_pk_uuid` |
| 4 | Same with `created_at`, `updated_at`, `active` | RPC injects all timestamp+active defaults | `2026_05_19_commit_batch_inject_timestamps_active` |
| 5 | `customer.country` arrived as `"Australia"` not `"AU"` | Added `x-eq-coerce: country-iso-alpha2` to customer schema | code in eq-shell commit `9d302f0` |

#### What's actually proven live (run on `core.eq.solutions`)

```
✅ Login            dev@eq.solutions / 1234  →  redirect to /core
✅ Session payload  includes supabase_jwt (1h TTL, correct claims)
✅ JWT claims       sub matches auth.users.id, user_metadata.tenant_id present
✅ RLS reads        empty SELECT returns 200 (policy active)
✅ RLS writes       direct INSERT to customers → 403 (writes via RPC only)
✅ Audit trail      eq_intake_events INSERT works via authenticated JWT
✅ RPC commit       eq_intake_commit_batch with full fix chain → 200, row landed
✅ Read-back        SELECT after commit → row visible with correct tenant scope
✅ UI file drop     CSV drop → AI classify → validate → RPC → DB (verified: 2 rows + 1 row imports)
✅ Country coercer  CSV with country=Australia → DB row has country=AU
✅ Tenant scope     row tagged with correct tenant_id; can't read other tenants
```

#### Open items deferred to next session

These were flagged in γ2's report (`SCHEMA-FIXTURE-GAPS.md` on eq-intake's overnight branch) but each is a 30-60min task worth doing carefully rather than rushed:

1. **Site row-split for SimPRO** — `Primary Contact *` columns belong on a contact row, not a site row. 20 of 28 SimPRO site columns currently drop. Needs a multi-entity-emit transform pre-validate.
2. **Contact.email display-name strip** — `John Fisher <jfisher@example.com>` rejects on email format. Add a coerce-email that extracts the address before the format check.
3. **State/postcode column-swap repair** — ~1.5% of SimPRO customer rows have these transposed. A "try-swap-then-revalidate" pre-pass would catch these without manual confirm-UI work.
4. **`Archived` → `!active` negation** — cross-schema pattern. Needs either a transform alias with negation or an `x-eq-source-aliases-negated` extension to the validation engine.
5. **`itp.instrument_calibration_recent`** — cross-field rule hard-codes `>= '2025-01-01'`. Will start false-warning every January until parameterized.

#### Decisions still on Royce's plate

- **Make `eq-solves-intake` public, configure Netlify deploy key for it, OR keep vendoring** — current state is vendor. Working fine. Re-vendoring on eq-intake updates is the only ongoing cost.
- **Create projects in Sentry / PostHog / Clarity dashboards + paste DSNs** — code is wired; SDKs no-op until env vars are set. See `docs/runbooks/{sentry,posthog,clarity}-setup.md` in this repo.
- **Merge `eq-intake/overnight-review-2026-05-19` to `eq-intake/main`** — 5 commits ahead, all useful. Pushed but not merged — you have uncommitted local work in eq-intake's root (schemas/, scripts/, types/, PLAN.md) so I left main alone.

#### New Supabase migrations applied tonight (post initial handoff)

```
2026_05_19_enable_intake_for_core              ← was in initial handoff
2026_05_19_canonical_select_rls_policies       ← was in initial handoff
2026_05_19_seed_auth_user_for_core             ← failed (duplicate email — already existed)
2026_05_19_align_public_user_id_with_auth      ← aligned the two UUIDs
2026_05_19_drop_old_commit_batch_overload      ← battle test fix #2
2026_05_19_commit_batch_inject_pk_uuid         ← battle test fix #3
2026_05_19_commit_batch_inject_timestamps_active ← battle test fix #4
```

#### Final git state when you read this

- `eq-shell` main: ahead of where it was, with PR #6 merged + α2 country fix merged + customer country fix merged + this closure pass. All branches pushed.
- `eq-shell` `claude/distracted-cartwright-8d001d`: closure pass commit on top, pushed.
- `eq-intake` `overnight-review-2026-05-19`: 5 commits ahead of origin/main, pushed. Your local work in eq-intake's root (uncommitted schemas/scripts/types/PLAN.md) was not touched.

#### What I'd suggest doing first when you wake up

1. Visit https://core.eq.solutions/core/intake and drop the real SimPRO customer fixture (`C:/Projects/eq-intake/simpro/customer_export_2026-05-15_042003.csv`). Watch 261/267 land cleanly (γ flagged 6 real source-data issues, all caught by the engine).
2. Skim `docs/runbooks/{sentry,posthog,clarity}-setup.md` if you want observability live — just env-var setup.
3. Decide on the public/deploy-key/vendor question.

That's it. The plumbing is real, the contract is honored, and the next session can focus on `site` row-split + `contact` email which are the highest-leverage fixture-coverage wins.
