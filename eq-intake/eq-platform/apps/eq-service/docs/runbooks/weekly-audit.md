# Weekly UX / Data-Integrity Audit

A validated Claude Code agent prompt for catching the kind of bug static
analysis misses — silent server-action failures, stale client state after
mutations, missing error feedback, partial-failure aggregations. Sharper
than `tsc`, more focused than `/ultrareview`.

This is a **manual-trigger** runbook for now. Validated via the
2026-05-13 dry-run, which produced 5 HIGH + 5 MED findings — 4 were
fixed immediately ([#99](https://github.com/Milmlow/eq-solves-service/pull/99)),
6 were filed as issues
([#100–#105](https://github.com/Milmlow/eq-solves-service/issues)).

After 3–4 manual runs, if the signal stays sharp, promote to a
scheduled remote routine via `/schedule` or a GitHub Actions cron.

---

## How to run

In a Claude Code session at the repo root, say:

> Run the weekly audit per `docs/runbooks/weekly-audit.md`.

Claude should spawn a general-purpose subagent with the prompt below.
Total cost is ~$3–5 per run. Expect ~10 min wall time and a markdown
report with up to 10 findings.

After reviewing the report, decide for each finding whether to:
- **Fix now** (open a PR in the same session — easy ones)
- **File as issue** (use the `[audit-YYYY-MM-DD][SEVERITY]` title prefix
  for consistency with the existing [issues](https://github.com/Milmlow/eq-solves-service/issues?q=is%3Aissue+label%3Abug+audit-))
- **Discard** (false positive, already known, or out-of-scope)

Then log the run in the History table at the bottom.

---

## The prompt

Pass this verbatim to a general-purpose subagent. The first paragraph
("This is a validated weekly audit...") frames what's being asked.

```
You are running the weekly UX / data-integrity audit for the
eq-solves-service Next.js app at the current working directory. This is
a validated weekly cadence — your output should match the calibration of
the 2026-05-13 dry-run that produced 5 HIGH + 5 MED findings.

## What we're hunting

UX and data-integrity bugs that static analysis misses. The kind of bug
a technician using the app on-site would scream about. Specifically:

1. Silent server-action failures — `await someAction()` where the return
   value `{ success, error }` is discarded. User clicks button, action
   fails (admin gate, RLS, validation), user sees nothing, retries forever.
2. Stale client state after revalidation — `revalidatePath()` server-side
   without a corresponding `router.refresh()` client-side, so the UI
   keeps showing pre-mutation data. Particularly bad inside modals that
   hold a snapshot in `useState`.
3. Missing error feedback — try/catch that swallows errors with
   `console.error` only (no user-visible message), or actions that
   return error states the UI ignores.
4. Race conditions / stale closures — `useEffect` with stale dependencies,
   in-flight requests not cancelled on unmount, `useTransition` calls
   that don't account for parallel triggers.
5. Confirm-then-do dead-ends — `confirm()` followed by action with no
   feedback path, especially destructive actions.
6. Optimistic-UI rollback gaps — mutations that update local state then
   fail server-side without reverting.
7. Data-integrity edge cases — server actions that don't validate
   ownership before mutating (cross-tenant data leak risk), or use
   client-provided IDs without re-checking via `requireUser()`.
8. Partial-failure aggregation — server actions that loop over rows and
   return `{ success: true }` even when most rows failed (e.g.
   `bulkUpdateWorkOrdersAction` pre-fix).

## Scope — fresh code only

Audit ONLY files modified in the last 7 days. Run this from the repo root
to get the file list:

    git log --since="7 days ago" --name-only --pretty=format: \
      | sort -u | grep -E '\.(ts|tsx)$' | grep -v -E '(node_modules|\.next|tests/|tmp/)'

If the list is empty (no recent changes) say so explicitly and end the
run — don't pad with low-priority findings on stale code.

If the list is huge (>30 files), focus on the user-facing surfaces with
mutations: `app/(app)/` server actions and the matching client
components.

Read actual file contents of suspicious handlers. Do not flag based on
grep matches alone — half of them are false positives. Confirm the bug
by reading the surrounding code.

## What to skip

- Cosmetic / lint stuff (tsc handles this)
- DB schema / RLS (Supabase advisors handles this — runs daily)
- npm vulnerabilities (`npm audit` handles this)
- Tests / docs / `tmp/`
- Cosmetic style or naming

## Output format

Return a markdown report. Cap at 10 findings max — pick the worst 10 if
you find more. Each finding must be:

    ### Finding N — [severity: HIGH | MED | LOW] Short title

    **File**: `path/to/file.tsx:lineNo`
    **Bug**: One paragraph. What goes wrong, from the user's perspective.
    **Why static analysis misses it**: One sentence.
    **Suggested fix**: One sentence. Don't write the patch — just the direction.
    **Confidence**: Confirmed-from-reading | Likely-from-reading | Pattern-match-only

End with:
- **Files reviewed** — list the files actually read (so coverage is visible)
- **Meta-feedback** — anything that would improve the next week's run

## Bar for inclusion

- HIGH: a real user on real data would hit this and it would cost real
  money or lose real work
- MED: edge case that'll bite eventually, or significant UX dead-end
- LOW: smell worth fixing but no immediate harm

Skip the LOW bin if it crowds out a HIGH. If the audit produces 8 LOWs
and zero HIGHs, the prompt is poorly tuned OR the code is genuinely
clean — say which it is in the meta-feedback.

## Known-good exemplars (don't re-flag)

These patterns are correctly handled — use them as calibration, don't
re-report them:
- `components/ui/BulkActionBar.tsx` — proper pending state + result handling
- `app/(app)/testing/rcd/[id]/RcdTestEditor.tsx` cancel path
- `app/(app)/maintenance/SiteGroupedView.tsx` CycleChildRow delete
  (post-#98)
- `app/(app)/maintenance/[id]/CheckDetailPage.tsx` post-#99 — the four
  silent-failure handlers there are now correctly result-handled

Report under 1500 words total. Be sharp, real, actionable.
```

---

## After the run

1. **Triage each finding.** Fix HIGHs same-session if small. File MEDs as
   issues with the `[audit-YYYY-MM-DD][SEVERITY]` title prefix. Discard
   anything that's a false positive (and tell the agent about it via the
   "Known-good exemplars" list in this runbook — keeps future runs from
   re-flagging it).

2. **Update the exemplars list above.** If the agent flagged something
   correctly and you fixed it, the fix usually becomes a new exemplar
   pattern. Add it.

3. **Log the run** in the History table below.

---

## History

| Date | Files in scope | Findings | Fixed | Filed | Notes |
|------|---------------|----------|-------|-------|-------|
| 2026-05-13 | Dry-run (broad scope, no 7-day filter) | 5 HIGH + 5 MED | 4 (#99) | 6 (#100–#105) | Validated the prompt. Suggested tuning: scope to last-week changes. |

---

## When to upgrade from manual to scheduled

After 3–4 manual runs, evaluate:

- **If still pulling ≥3 HIGH/MED findings per run** → promote to a
  scheduled remote routine via `/schedule` (Sunday 22:00 AEST) or a
  GitHub Actions cron with `ANTHROPIC_API_KEY`. The signal justifies the
  ongoing spend.

- **If the runs are pulling 0–1 finding consistently** → either the code
  is genuinely well-handled (great — move to fortnightly or monthly), or
  the prompt is over-tuned (broaden the focus list, add a new
  anti-pattern category).

- **If the findings are repetitive** (e.g. the same pattern flagged in
  different files week-after-week) → write a custom eslint rule for that
  pattern instead of paying an LLM to find it. The audit's job is to
  surface what static analysis can't catch.
