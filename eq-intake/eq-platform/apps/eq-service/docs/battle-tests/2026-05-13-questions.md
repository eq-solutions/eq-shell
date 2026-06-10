# Battle test — 2026-05-13 queued questions

Four questions for Royce. All are out of scope for inline tiny fixes (auth-flow, multi-file, or strategic). Knock through in the morning.

---

## Q1 — P1 — Customer portal sign-in entirely unreachable

**Where:** `lib/auth/mfa-routing.ts:23-28` (`PUBLIC_PATHS`); `app/(portal)/portal/login/page.tsx`; `app/api/portal/magic-link/route.ts`

**Symptom:** `curl -sIL http://localhost:3000/portal/login` → 307 to `/auth/signin?next=%2Fportal%2Flogin`. Following the redirect lands on the staff sign-in page (h1 "Welcome to EQ Solves Service"), not the customer magic-link form. POSTing to `/api/portal/magic-link` returns the same 307. Net: zero customers can sign in to the portal as it stands.

**Why it matters:** The customer portal is shipped (PRs #79, #80) but its only entry point is gated behind the staff auth flow. The fix is a one-line addition to `PUBLIC_PATHS`, but it's an auth-flow change.

**Options:**
1. (recommended) Add `/portal/login` and `/api/portal/magic-link` to `PUBLIC_PATHS` in `lib/auth/mfa-routing.ts`, plus `/auth/callback` already handles the magic-link redirect on its way back. ~3 LOC. The corresponding regression test (`tests/lib/auth/mfa-routing.test.ts`) also gets two new assertions so we can't drop these later.
2. Add a separate `PORTAL_PUBLIC_PATHS` constant and split the public-path classification by area — cleaner conceptually but more code, and the test surface doubles.
3. Move the portal login form to `/auth/portal-signin` so it sits inside `/auth/*` (already in `PUBLIC_PATHS`). Forces a route change but consolidates auth surfaces under one prefix.

**Recommendation:** Option 1. Smallest change, lowest risk, matches how the codebase treats `/auth/forgot-password` and other public auth pages today. Adds the regression-test pair to keep it landlocked.

---

## Q2 — P1 — PR #82 commit `01d1388` (proxy admin gate fix) was never merged to `main`

**Where:** `proxy.ts:82-94` (admin gate still reads `profiles.role`); `git merge-base --is-ancestor 01d1388 origin/main` → false.

**Symptom:** The prompt's premise was "PR #82 flipped from `profiles.role` to `tenant_members.role`". The local commit exists; it's not in `origin/main`. Same for the cron-bootstrap runbook (`31c7a27`), the run-sheet filename fix (`14e9168`), the job-plan-items label fix (`205d7a8`), the a11y h1 fix (`8b8faa3`), the demo seed (`b6ca658`), the channel-defaults flip (`d88a3c6`), the Phase A tier UI commits (`03182e1`, `ab39143`), and the workspace-pin config (`83c909d`). The DB has the migrations applied; just the code/docs lag.

**Why it matters:** Production proxy still uses `profiles.role` for `/admin/*`, so the original Issue #19 (super_admin via profile.role bypasses proxy gate but gets bounced at page level) persists. CLAUDE.md says it's fixed.

**Options:**
1. (recommended) Cut a single sweep PR `chore(merge): land stranded PR-#82-era commits` — cherry-pick the 11 commits in chronological order, run typecheck + smoke tests, open against `main`. Bundles auth + a11y + filename + label + tier UI in one review surface. Royce reviews once, merges once.
2. Open separate PRs per concern (auth gate, runbook, tier UI, polish bundle). Cleaner blame trail, but four reviews instead of one.
3. Treat the stranded commits as orphans and rewrite from current `main` baseline. Most work, lowest fidelity to the original PR-#82 intent.

**Recommendation:** Option 1. The commits already passed review on their original branches; bundling them is a paper-trail exercise, not a re-review. Each concern has a distinct conventional-commit prefix so the merged history stays legible.

---

## Q3 — P1 — Notifications dispatcher is no-op'ing in production (cron_secret unset)

**Where:** Supabase function `dispatch_scheduled_notifications()` (the `IF v_secret IS NULL` guard); `vault.secrets` is empty.

**Symptom:** `cron.job_run_details` shows the cron firing every 15 min with `succeeded`. But the function returns early because `cron_secret` doesn't exist in Vault, so `/api/cron/dispatch-notifications` is never called. `notifications` table has 10 pre-dispatcher rows from April; nothing inserted by the cron. Operational, not a code bug — but the runbook that explains the bootstrap (`31c7a27 docs(runbook): notifications cron bootstrap`) is also not on `main`, so the next person looking at this has no entry point.

**Why it matters:** Phase A/B/C of the notifications stack is all sitting idle in production. Supervisor digests, pre-due reminders, customer monthly summary, customer upcoming-visit emails — none firing. Once you flip the secret on, all four phases activate at once; no UI to flip individually.

**Options:**
1. (recommended) Run the bootstrap now: generate hex secret, set in Netlify env (`CRON_SECRET=...`), then `select vault.create_secret('<hex>', 'cron_secret');` in Supabase. Verify with the manual smoke (`?force_user_id=<uuid>`). Then merge the runbook commit `31c7a27` so the procedure is permanent.
2. Stage it: bootstrap on a non-prod tenant first (would need a staging Supabase project, currently we don't have one). Two-environment lift but gets a controlled first fire.
3. Defer until after the PR #82 sweep merges (Q2) — the runbook is part of that bundle, so the bootstrap and its documentation land together.

**Recommendation:** Option 3 — wait for the PR #82 sweep so the runbook merges with the bootstrap action, then run the bootstrap in the same morning. Keeps the audit trail clean: "ran the runbook" maps to "this is the runbook" in the same hour.

---

## Q4 — P2 — Re-apply the third stranded tiny fix (`8b8faa3 fix(a11y): single h1 per page`)?

**Where:** `8b8faa3` touches `app/(app)/testing/acb/page.tsx`, `app/(app)/testing/nsx/page.tsx`, `app/(app)/testing/rcd/import/page.tsx`, `components/ui/TestDetailHeader.tsx` (9 LOC, 4 files).

**Symptom:** Same pattern as the run-sheet filename fix (already re-applied tonight) and the job-plan-items label fix (also re-applied) — the commit exists locally, not on `main`. Demotes inner h1s to h2s on `/testing/*` so screen readers announce one "current page" per document. Currently `/testing/*` pages produce two h1 elements.

**Why it matters:** Real a11y issue (WCAG 2.4.6 / 2.1.1). I applied the two single-file fixes inline tonight. This one is multi-file — within the README's ≤30 LOC bound but spreads across 4 components, which feels right at the edge of "tiny."

**Options:**
1. (recommended) Bundle into the Q2 sweep. Already-tested commit with a clean message; lands with the rest of the stranded set.
2. Apply inline now on this branch. Tightens this PR's scope to "battle test outputs + tiny fixes," at the cost of crossing the README boundary on file-count.
3. Open as its own PR `fix(a11y): single h1 per page on /testing/*`. Cleanest blame, most overhead for the smallest change.

**Recommendation:** Option 1. The commit was authored on the same evening as the other stranded fixes; bundling it preserves the original review context. If Q2 doesn't get the sweep nod, fall back to Option 2 next run.
