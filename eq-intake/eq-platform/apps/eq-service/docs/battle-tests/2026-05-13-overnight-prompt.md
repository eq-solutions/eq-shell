# Battle test — 2026-05-13 overnight

## How Royce kicks this off

1. Wait until [PR #83](https://github.com/Milmlow/eq-solves-service/pull/83) (this branch's PR) merges to main. If you start the run before it lands, the agent has stale docs.
2. From a fresh Claude Code session in the project root (`C:\Projects\eq-solves-service`), paste the **Agent prompt** below.
3. Confirm the agent created `claude/battle-test-2026-05-13` branch off main.
4. Step away. Agent commits + opens a PR overnight.

> **Before launching:** PR #93 wired the agent to sign in via service-role
> mint — no passwords stored anywhere. Confirm `.env.local` has
> `BATTLE_TEST_ADMIN_EMAIL`, `BATTLE_TEST_ADMIN_UUID`,
> `BATTLE_TEST_PORTAL_EMAIL`, `BATTLE_TEST_PORTAL_UUID`, and a valid
> `SUPABASE_SERVICE_ROLE_KEY`. If the UUIDs aren't set, run
> `npx tsx scripts/bootstrap-battle-test-users.ts` per
> `docs/battle-tests/README.md` — it provisions the two users and prints
> the UUIDs to paste back into `.env.local`. The agent signs in by minting
> a magic link at run time (see snippet below). Do **not** commit
> credentials and do **not** add `_PASSWORD` env vars — passwords are
> intentionally out of scope.

---

## Agent prompt (paste below this line)

```
You are running an overnight battle test for the eq-solves-service repo.
Read `docs/battle-tests/README.md` end-to-end before doing anything else —
that file defines the tiny-fix boundary, the question format, the
branch/PR pattern, the severity scale, and the rules of engagement. Treat
the README as binding.

Then run through the 10 surfaces below in order. Time-box ~15 minutes per
surface. Aim for ~3 hours total. Stop at 4 hours regardless of progress.

## Setup (do this first)

1. Confirm git status is clean on main, then create branch
   `claude/battle-test-2026-05-13` off `origin/main`.
2. Start the dev server (`npm run dev`) and confirm it boots without
   errors. If it doesn't, your first finding is whatever's broken about
   boot — write it up, do NOT try to fix it, stop.
3. Sign in as the super_admin test user via service-role magic-link mint
   (no password). Use this snippet — same as `docs/battle-tests/README.md`
   lines 116–124:

   ```ts
   import { createClient } from '@supabase/supabase-js'
   const supabase = createClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.SUPABASE_SERVICE_ROLE_KEY!,
     { auth: { autoRefreshToken: false, persistSession: false } },
   )
   const { data, error } = await supabase.auth.admin.generateLink({
     type: 'magiclink',
     email: process.env.BATTLE_TEST_ADMIN_EMAIL!,
   })
   // visit data.properties.action_link via the browser MCP
   ```

   The link establishes a Supabase session for `BATTLE_TEST_ADMIN_UUID`.
   You're operating against the demo tenant
   `a0000000-0000-0000-0000-000000000001`. SKS data
   (`ccca00fc-cbc8-442e-9489-0f1f216ddca8`) is read-only for you — use it
   for cross-tenant leak checks, never write to it.

If browser automation is available via `mcp__Claude_Preview__*` or
`mcp__Claude_in_Chrome__*` MCP tools, prefer those over code-reading for
behavioural surfaces (anything where the user-visible outcome matters more
than the code shape). Fall back to dev-server fetches + code inspection
when not.

## The 10 surfaces

For each surface: list expected behaviour, what you actually saw, severity
if different, and either land a tiny fix (per README rules) or queue a
question (per README format).

### 1. Customer portal end-to-end — P1-class

Surfaces: `/portal/login`, `/portal/sites`, `/portal/visits`,
`/portal/scope`, `/portal/defects`, `/portal/variations`.

- Sign in as the portal user via the same `generateLink()` flow used in
  setup step 3, but pass `BATTLE_TEST_PORTAL_EMAIL` instead. The link
  establishes a session for `BATTLE_TEST_PORTAL_UUID`. No password.
- Walk each portal route. Confirm RLS holds — the portal user should
  see only their assigned customer's data, never another customer's.
- `/portal/sites` specifically: confirm it redirects to `/portal/login`
  when not authenticated. CLAUDE.md flags this as Issue #24 — known
  inconsistency, verify whether the inconsistency still exists.
- Mobile responsiveness: resize to ~375px (iPhone SE) and walk the same
  routes. Layout should not break.

### 2. Notifications dispatcher (pg_cron) — P0-class

Surfaces: `cron.job` table, `notifications` table,
`notification_dispatch_log`, the dispatcher edge function or pg function.

- Confirm pg_cron is actually firing. Inspect last 24h of
  `notification_dispatch_log` rows. Are any in `failed` state? Why?
- Trigger a notification manually (create a maintenance check that's
  about to go overdue, or change a defect to severity high). Confirm:
  (a) row lands in `notifications` table, (b) channels respect the
  user's `notification_preferences` (or defaults — post migration 0091
  the channel defaults flipped to OFF), (c) email actually delivers via
  Resend (check Resend dashboard if you have access).
- Idempotency: simulate a dispatcher restart mid-batch. Are notifications
  re-fired or deduped?

### 3. Self-serve email prefs + defect notifications — P1-class

Surfaces: `/settings/notifications` (or wherever the prefs UI lives —
find it), defect creation flow.

- Toggle each channel on/off as the admin user. Confirm `notification_preferences` row
  updates and `get_effective_notification_prefs()` returns the expected
  values immediately.
- Create an ACB defect or NSX defect on the demo tenant. Confirm
  the defect notification fires to the technician + admin per their
  prefs. If technician has email OFF, they should NOT receive email
  (only bell).
- Unsubscribe link: open a delivered email, click the unsub link, confirm
  it works without re-authenticating, confirm it sets the right prefs flag.

### 4. Auth gate change — P0-class

Surface: `proxy.ts` admin gate (PR #82 commit `01d1388` flipped from
`profiles.role` to `tenant_members.role`).

- Find or create a test user where `profiles.role = 'super_admin'` but
  `tenant_members.role = 'supervisor'`. Hit `/admin/users`. Expected:
  redirect to `/dashboard`. (Pre-#82 they'd reach `/admin/users` then
  bounce back from the page-level check.)
- Confirm normal admin still reaches all `/admin/*` routes.
- Confirm a deactivated user (`profiles.is_active = false`) is signed
  out regardless of tenant_members state.

### 5. MFA flow (permanent regression watch) — P0-class

Surfaces: `/auth/signin`, `/auth/mfa`, `proxy.ts` AAL gate.

- Sign in with a TOTP-enrolled user. Confirm normal flow works.
- Force an AAL1 stale session (sign in, manually downgrade JWT via
  Supabase dashboard or by waiting if you can simulate). Hit `/auth/mfa`.
  Confirm no redirect loop.
- Check PostHog for `mfa_redirect` events in the last 24h. Two redirects
  within ~30s for the same user = loop signal. CLAUDE.md flags this as
  the canonical recurrence signal.

### 6. Field Run-Sheet kind-aware generation — P2-class

Surface: `/api/maintenance-checklist`.

- Generate for a `kind=maintenance` check (PPM). Confirm one card per
  check_asset with task rows.
- Generate for a `kind=acb` check. Confirm one card per linked acb_test
  with the 5-row task list (brand/model/serial, visual & functional,
  electrical readings, overall result, notes).
- Generate for a `kind=nsx` check. Same shape as acb.
- Generate for a `kind=rcd` check. Confirm one card per board with one
  row per circuit (section, circuit no, trip rating, blank X1/X5 fields,
  button-test checkbox).
- Confirm brand strip uses `adjustHex(primaryColour, -0.20)` — for SKS
  (#7C77B9) this should be deep purple. For demo (sky blue) this should
  be deep sky.
- Confirm filename pattern: `Run-Sheet - {siteName} - {format} - {YYYY-MM-DD}.docx`.

### 7. Customer Report bundling — P2-class

Surface: `/api/pm-asset-report` and the "Customer Report" button on
`/maintenance/[id]`.

- Generate a Customer Report for the canonical demo PPM check
  (`10000000-0000-0000-0000-000000000001`). Demo seed has 4 ACBs + 20
  tasks now. Confirm asset detail cards render.
- Generate for the demo RCD check (`13000000-0000-0000-0000-000000000001`).
  Demo seed has 10 circuits. Confirm RCD Circuit Timing per board renders.
- Generate for a check with linked ACB + NSX tests (find one via
  `linked_tests` join). Confirm Breaker Test Detail section appears with
  identification grid + readings table.
- Confirm cover page uses tenant logo only (customer logo dropped in PR #39).

### 8. Variations register feature flag — P3-class

Surface: `/variations`, sidebar Insight section.

- Confirm `commercial_features_enabled = false` on a tenant hides the
  Variations sidebar entry.
- Confirm flipping it to true reveals the entry immediately (or after
  page refresh).
- Confirm `/variations` doesn't 500 on a tenant with the flag enabled
  but zero variation rows.

### 9. Scope statement DOCX/PDF + renewal pack — P2-class

Surfaces: `/contract-scope` (the Scope Statement button), Renewal Pack
admin page (`/admin/renewal-pack` if still exists per recent changes).

- Generate a scope statement DOCX for the demo customer. Confirm it
  downloads with the right tenant brand + customer name. PR #73 fixed
  the silent-failure case — confirm error toasts now appear if generation
  fails.
- Generate a renewal pack (Phase 7 stretch). Confirm it handles the
  zero-history case (a new customer with no historical data).

### 10. Jemena RCD Year 2+ flow — P2-class

Surface: `/maintenance` → New Check → pick site + Jemena RCD Testing.

- Use the demo tenant (Jemena seed lives on SKS — read-only for you).
  If demo doesn't have Jemena-style RCD data, skip this surface and note
  in the brief that the demo seed needs Jemena coverage for future runs.
- Otherwise: pick a site with a prior RCD test, confirm the preview shows
  the `✨ N circuits will be pre-populated from last visit` badge per board.
- Create the check. Confirm `rcd_tests` rows are cloned correctly with
  blank timing values but cloned section/circuit_no/rating/critical flags.

## Wrap-up

1. Write `docs/battle-tests/2026-05-13-brief.md` per README format.
2. Write `docs/battle-tests/2026-05-13-questions.md` if any meaningful
   questions queued.
3. Stage and commit:
   - One commit per tiny fix landed inline (conventional commit prefix)
   - One final commit: `docs(battle-test): brief + queued questions 2026-05-13`
4. Push the branch.
5. Open a **DRAFT** PR against `main` (`gh pr create --draft`). Title:
   `Battle test 2026-05-13 — N findings, M tiny fixes, K questions`.
   Body: the brief content verbatim + a "## Queued questions" section
   linking to the questions file. Draft means Royce can mark it
   Ready for Review after a quick morning scan — don't open as a
   regular PR.

## What to ignore

- `/admin/billing` returns 404 — intentional, Phase B isn't built yet.
- Plan chip in header says `Team · Standard` for everyone — intentional,
  default backfill from migration 0092.
- `tmp/` and `node_modules/` — gitignored, do not touch.
- Stripe wiring — does not exist yet, do not try to test.
- The Cowork worktree cleanup that happened on 2026-05-13 — already
  investigated, not a regression to fix.

Hard stop at 4 hours regardless of progress. If you've only covered 6
of the 10 surfaces, the brief should say so and prioritise the missing
4 for the next run.
```

---

## Notes for Royce

- The agent will create `claude/battle-test-2026-05-13` — don't have
  another branch with that name already.
- Stripe is intentionally out-of-scope. If the agent finds itself in
  `/admin/billing` it should bounce out, not investigate.
- Surface 1 (portal) and surface 4 (auth gate) carry the highest risk.
  If something has to be cut for time, cut surfaces 8–10 first.
- Credentials are minted at run time via `supabase.auth.admin.generateLink()`
  (PR #93 closed the password-storage gap). The one-time bootstrap is
  `npx tsx scripts/bootstrap-battle-test-users.ts` — it provisions both
  test users on the demo tenant and prints the UUIDs to paste into
  `.env.local`. See `docs/runbooks/battle-test-creds-bootstrap.md` for
  the full procedure.
