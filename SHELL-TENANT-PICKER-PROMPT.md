# Shell tenant picker — fresh-session prompt

**Run this prompt as a fresh Claude Code session.** It is self-contained — you will not have memory of the conversation that produced it. Read this whole document before doing anything.

You are Claude Opus 4.7, picking up where a previous session left off after that session blew through its token budget. Goal: implement a **tenant picker on the shell's FieldIframe page** so users can choose which Field tenant to load, then have the shell mint a handoff token for that tenant and embed the iframe. This is the final step of a multi-session arc that built up EQ Field's multi-tenant surface (Waves 1-4 + 4.5) and a Field-side picker (4.5b) — see "What's already shipped" below.

---

## 1. The vision (Royce's words, 2026-05-22 chat)

> "ultimately there shouldnt be a login page for field - core takes care of auth"
> "All i wanted was for the link to field to goto the field app that gives me the option to chose which version i want to use"

End-state matrix:

| Access path | What user sees |
|---|---|
| **Direct URL** `eq-solves-field.netlify.app` (no `?tenant=`) | In-Field picker overlay (already shipped in v3.5.18) → PIN gate → Field |
| **Direct URL** `eq-solves-field.netlify.app/?tenant=<slug>` | Skip picker → PIN gate → Field |
| **Shell** `core.eq.solutions/core/field` | **Shell-side picker → mint with chosen tenant_slug → iframe loads Field with no PIN gate** ← this is what you're building |

The Direct URL paths are already done. You are completing the Shell path.

---

## 2. What's already shipped (DO NOT redo)

### EQ Field repo (`C:/Projects/eq-solves-field`, branch `main`, default Netlify deploy)

| Version | Wave | What |
|---|---|---|
| v3.5.13 | 1 | `melbourne` + `demo-trades` tenants wired in `TENANT_SUPABASE` + `TENANT_BRANDING`; `tierAtLeast()` helper; Projects sidebar entry + page + modal (Advanced + Enterprise); project picker on Sites form; PostHog/Clarity `tier` user property |
| v3.5.14 | 2 | `project_targets` table + 1800-row schedule seed for `melbourne` (DB-side, via Supabase MCP); Forecast page (Enterprise) — 14-week grid with editable targets, region filter, available-pool + apprentice-ratio footers |
| v3.5.15 | 3 | People form `employment_type` / `rto` / `hire_company` fields (Advanced+Enterprise); Contacts page employment filter; Dashboard apprentice-ratio compliance widget (Enterprise, per-region sparkline + colour) |
| v3.5.16 | 4 | `regional_manager` enum value added; top-bar region picker (Enterprise); JS-side filtering on Contacts/Sites/Projects + Forecast sync |
| v3.5.17 | 4.5 | Shell-handoff token gains OPTIONAL `tenant_slug` claim; `_consumeShellToken()` cross-checks against `TENANT.ORG_SLUG`; new `tenant-mismatch` postMessage kind. **Backwards-compatible** — accepts tokens without the claim. |
| v3.5.18 | 4.5b | **In-Field tenant picker overlay** — visiting `eq-solves-field.netlify.app` with no `?tenant=` and no `#sh=` shows 3 cards (eq/demo-trades/melbourne) with PINs inline. Click → `?tenant=X` reload → existing PIN gate. |

DB state in EQ Field Supabase (`ktmjmdzqrogauaevbktn`):
- Three orgs: `eq` (Standard, SEED-demo), `demo-trades` (Advanced), `melbourne` (Enterprise, 577 ppl / 12 proj / 48 sites / 3 regions)
- `project_targets` table populated as users edit; empty by default

### EQ Shell repo (`C:/Projects/eq-shell`, branch `main`)

- `mint-iframe-token.ts` currently signs `{kind:'shell-token', name, role, eq_role, is_platform_admin, exp}` — **no `tenant_slug`** (the version that added it was reverted twice; see history below)
- `FieldIframe.tsx` mints on mount + embeds `https://eq-solves-field.netlify.app/#sh=<token>` — no `?tenant=`, no picker UI
- `shell_control.tenants` table has one row: `core` / EQ Solutions. There are NO `melbourne` / `demo-trades` rows. They were added earlier this session then removed (see history below)
- Single shell user: `dev@eq.solutions` on `core` tenant, `is_platform_admin=true`

### What was tried in earlier sessions and reverted (do not re-attempt without re-discussing)

1. **eq-shell#10**: shell mint included `tenant_slug` sourced from `shell_control.tenants.slug` of the user's tenant. Reverted in #11 because shell only had `core` tenant and Field has no `core` org → broken.
2. **eq-shell#12**: re-applied #10 after populating shell tenants with `melbourne` + `demo-trades` AND flipping `dev@eq.solutions` to `melbourne`. Reverted in #13 because Royce's actual ask was a picker, not auto-routing from the user's tenant_id. The shell tenant rows were also removed in the cleanup, and the user is back on `core`.

**Lesson:** auto-routing based on `users.tenant_id` is wrong. Users want to PICK from a list on every Field entry, regardless of which shell tenant they belong to.

---

## 3. What you're building

A tenant picker on shell's `FieldIframe` page. Concretely:

### 3.1 UX

1. User in shell clicks **Field** in nav → lands on `/core/field` (existing route)
2. **Instead of immediately minting + embedding iframe**, render a picker page with 3 cards (eq / demo-trades / melbourne) — same shape as the in-Field overlay at `eq-solves-field.netlify.app` v3.5.18 (you can read its markup for reference)
3. User clicks a card → component mints a shell-token via `mint-iframe-token` with the chosen `tenant_slug` → embeds iframe with `?tenant=<slug>#sh=<token>` → loads Field
4. Field's existing `_detectTenantSlug` picks up `?tenant=` → loads correct Supabase URL/branding → `_consumeShellToken` validates token + cross-checks tenant_slug → no PIN gate
5. Optionally: a small "Switch tenant" button persistent in the iframe wrapper (e.g. in the shell topbar area above the iframe) so users can hop without back-button gymnastics

### 3.2 Spec

**File `netlify/functions/mint-iframe-token.ts` (modify):**

- Accept POST body `{ tenant_slug: string }` (required)
- Validate `tenant_slug` is in an allow-list (hard-coded for now: `['eq', 'demo-trades', 'melbourne']` — match the cards). Reject with 400 if not.
- Don't fetch from `shell_control.tenants` — the value comes from the request body, picked by user. (You CAN still fetch user from `shell_control.users` for `name` and `role` derivation; that part is unchanged.)
- Include `tenant_slug` in the signed shell-token payload (the `ShellTokenPayload` type in `_shared/token.ts` already needs to be updated to add it — it was in the reverted PRs; you may want to re-add it as REQUIRED)
- Return `{ token, tenant_slug }` in the response body so the caller doesn't have to remember what it asked for

**File `netlify/functions/_shared/token.ts` (modify):**

- Add `tenant_slug: string` to `ShellTokenPayload` interface (required field)

**File `src/pages/FieldIframe.tsx` (rewrite the mint flow):**

- Add state: `selectedTenant: string | null` (null = picker shown)
- When `selectedTenant === null`, render picker UI (3 cards). Each card sets `selectedTenant`
- When `selectedTenant` is set, kick off the existing mint+embed flow but with `body: JSON.stringify({ tenant_slug: selectedTenant })` and the iframe URL `${FIELD_URL}?tenant=${slug}#sh=${token}`
- Keep all the existing handoff overlay states (boot/accepted/rejected/http-error/network-error/tenant-mismatch) intact
- Add a small "Switch tenant" affordance (e.g. button in topbar area or above iframe) that resets `selectedTenant` to `null` so the picker comes back
- The `tenant-mismatch` overlay state and `'tenant-mismatch'` postMessage kind in `HandoffMessage` need to be re-added (they were in the reverted PRs — copy from the diff if useful: `git log --all --oneline -- src/pages/FieldIframe.tsx` shows the reverted commits)

### 3.3 What stays unchanged

- The shell session cookie (`eq_shell_session`) and `verify-shell-session` flow
- `shell_control.tenants` table contents (just `core` — do not add more unless explicitly asked; the picker is hardcoded with Field slugs, not shell tenant slugs)
- `dev@eq.solutions` user's `tenant_id` (stays on `core`)
- All Field-side code — v3.5.17's `_consumeShellToken` cross-check fires correctly when token has `tenant_slug` matching the URL's `?tenant=` param
- The direct-URL path to Field (`eq-solves-field.netlify.app/?tenant=X`) — completely independent of this work

---

## 4. Hard rules

1. **AUTH SURFACE CHANGE.** Show Royce the PR description before merging and confirm. Per his global rule: "Auth changes require explicit approval before any deployment."
2. **Do NOT touch `shell_control.tenants` or `shell_control.users` without explicit approval.** The picker is hardcoded with Field slugs; no DB changes needed.
3. **Do NOT re-introduce auto-routing from `users.tenant_id`.** That model was rejected.
4. **Test the deploy preview before merging.** The preview URL is in the PR's `gh pr checks` output. Smoke: visit `/core/field`, see picker, click melbourne, see iframe load with `?tenant=melbourne#sh=...`, see Field render melbourne data. Test `eq` and `demo-trades` too.
5. **Don't break the direct-URL Field paths.** `eq-solves-field.netlify.app/?tenant=X` must continue to work; `eq-solves-field.netlify.app` must continue to show the in-Field picker.
6. **Halt + write `SHELL-PICKER-HALT.md` if:** Field's `_consumeShellToken` starts returning `tenant-mismatch` errors after deploy (means the token's `tenant_slug` doesn't match what Field's `_detectTenantSlug` picks up — diagnostic indicates the URL param isn't being passed correctly).
7. **Budget cap: $40.** This is one focused PR. If you're past $40 with the work incomplete, stop and write up where you are in a hand-off doc.

---

## 5. First 5 minutes — orient

Read these files in this order:

| File | Why |
|---|---|
| `netlify/functions/mint-iframe-token.ts` | What you're modifying (the mint function) |
| `src/pages/FieldIframe.tsx` | What you're modifying (the iframe page + handoff state machine) |
| `netlify/functions/_shared/token.ts` lines 49-80 | The `ShellTokenPayload` interface you're extending |
| Field's `scripts/auth.js` `_consumeShellToken()` function (lines 377-426 of `C:/Projects/eq-solves-field/scripts/auth.js`) | What Field does with the token, especially the v3.5.17 tenant_slug cross-check |
| Field's `index.html` lines ~218-280 (the inline tenant-picker overlay markup at top of `<body>`) | Reference for picker UI shape — match the look so direct-URL + shell picker feel consistent |
| Recent shell history: `git log --oneline -20` | See the revert/re-apply chain so you don't redo it |

Then ask Royce one question: **"Should the shell picker open in a new tab (so they can have multiple tenants open) or replace the current shell view?"** — this affects whether you mount the picker in `FieldIframe.tsx` or treat it as a separate route.

---

## 6. Shipping process

1. **Branch.** `git checkout -B claude/shell-tenant-picker origin/main`
2. **Code.** Per spec above.
3. **Local typecheck.** `pnpm exec tsc --noEmit -p tsconfig.app.json` and `pnpm exec tsc --noEmit -p tsconfig.netlify.json` — both must pass.
4. **Local lint.** `pnpm exec eslint <files-you-touched>` — there's a pre-existing `_context` unused warning in `mint-iframe-token.ts`; ignore. Don't introduce new ones.
5. **Commit.** Tight message, single commit. Co-Authored-By Claude Opus 4.7 footer.
6. **Push + PR.** `gh pr create`. Body must include: spec summary, AUTH SURFACE CHANGE notice, test plan, link to this prompt.
7. **WAIT for Royce's approval before merging.** This is an auth change. Even if CI is green, hold the merge.
8. **After approval:** merge, wait for prod deploy (`https://core.eq.solutions`), smoke test `/core/field` → picker → click melbourne → iframe loads.

---

## 7. Recovery

If anything goes sideways:

- **Mint endpoint returns 500:** check `EQ_SECRET_SALT` env var is set on the eq-shell Netlify project (it is in production; should be in deploy-preview too)
- **Token rejected by Field with `tenant-mismatch`:** the iframe URL's `?tenant=` param doesn't match the token's `tenant_slug` claim. Inspect the actual URL the iframe loads + decode the token payload (`atob(token.split('.')[0])`)
- **Picker doesn't render:** check `selectedTenant` state is initialized to `null` and the JSX guard is correct
- **Iframe sandbox/CSP errors:** the existing `sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"` should still work; don't change it without a reason

If reverting:
- `git revert <merge-sha>` and push to a revert branch + PR
- Field side needs no rollback — v3.5.17's `_consumeShellToken` is backwards-compatible (accepts tokens without `tenant_slug` claim)

---

## 8. When you finish

1. Confirm with Royce that the end-to-end flow works (click Field in shell → picker → pick melbourne → see Enterprise surface inside iframe, no PIN gate)
2. Update any handoff doc if appropriate
3. Exit cleanly (no uncommitted changes)

Done. Royce will pick this up in the morning if the session times out.
