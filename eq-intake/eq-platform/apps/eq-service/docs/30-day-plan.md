# 30-Day Plan — Surfaced 2026-04-26

Consolidated punch list of everything flagged during the 2026-04-26 review and reports-redesign session. Each item has: a one-line description, why it matters, rough effort, and a recommended priority bucket.

This is a reference document — it doesn't enforce anything. Use it as the input when you decide what to work on next, and update/cross off as items land.

> **Update 2026-04-27:** Royce gave explicit go to "all suggestions" overnight,
> including auth items B1a/B1b/B1c. Items below marked **[DONE]** landed in
> commits during 2026-04-26 → 2026-04-27 review session. Items still showing
> as priority are either Royce-manual (DB writes, external accounts), partial
> due to scope (S2 full threading), or genuinely future work.

---

## Priority A — ship within ~7 days

These are the items where the cost of *not* doing them is real (hidden bug, ongoing brand damage, or operational risk).

### A1. Pre-push build gate **[DONE 2026-04-27]**

`npm run check` (`tsc --noEmit && next build`) shipped as a script. GitHub
Action at `.github/workflows/check.yml` runs `npm run check + npx vitest run`
on every push to main and on every PR. Removes the "I forgot to run build
locally" class of failure surfaced twice during the review session.

### A2. Reports design audit fixes **[DONE 2026-04-27]**

Phase 1 (S1 fonts, S3 greys, N1 borders, N2 brand fallback) and most of
Phase 2 (S2 ice partial, S4 FlatUI swap, Q1 fail-visibly, Q2 sizing,
Q3 brand strip, Q4 contrast, N3 cast) all landed during the overnight
session. See [docs/audits/2026-04-26-reports-design-audit.md](docs/audits/2026-04-26-reports-design-audit.md)
for status banner and per-item commits.

The one partial item is S2 full (tenant-aware ice across all generators).
Implemented for pm-check-report only; the other four generators use
`EQ_ICE` (brief default). Threading through nsx/acb/compliance/work-order
needs ~6 builder fns × 4 generators of refactoring for marginal visual
gain — left as a follow-up if any customer flags the colour mismatch.

### A3. SKS `report_company_abn` is null

Migration 0015 added the column, but it was never populated for SKS. Current report covers read "Confidential — SKS Technologies" with no ABN suffix. Set via `/admin/reports`. ~2 min if you have the ABN handy.

### A4. eq-context merge conflicts

Markdown sweep flagged unresolved `<<<<<<<` / `=======` / `>>>>>>>` blocks in `C:\Projects\eq-context\state\products.md` and `state\pending.md`. These files load into every Claude session as project context — they've been silently broken for who knows how long. Resolve manually. ~5 min.

### A5. Supabase backup restore drill (~30 min)

You confirmed backups are on but nobody has tested a restore. "Backups exist" ≠ "we can restore." One-time drill: create a Supabase branch project, restore yesterday's snapshot into it, click through the app pointing at the branch, confirm it loads. After that you have an honest answer to "what's our recovery time."

---

## Priority B — within 30 days

Real issues but not on fire today.

### B1. Auth hardening pass **[DONE 2026-04-27 — Royce explicit go]**

All three items landed:

- **B1a [DONE]:** `requireUser()` membership query now `.order('created_at', { ascending: true }).order('tenant_id', { ascending: true })` so multi-tenant users land deterministically. Full tenant-switcher UI is the proper long-term fix — still a follow-up.
- **B1b [DONE]:** `'use server'` directive removed from `lib/actions/auth.ts` and `lib/actions/idempotency.ts`. Both files are now plain helpers, not Next.js server-action endpoints.
- **B1c [DONE]:** Pure-function MFA routing helpers extracted to `lib/auth/mfa-routing.ts` with vitest spec at `tests/lib/auth/mfa-routing.test.ts` (21 tests, all passing). Asserts `/auth/signin` is in `AAL_EXEMPT_PATHS` so the AAL1-loop fix has a regression test.

### B2. Cross-tenant isolation smoke test **[PARTIAL 2026-04-27]**

Static-audit version landed at `scripts/audit-rls.ts` (registered as
`npm run audit:rls`). Verifies every public table has RLS enabled —
catches "new table added without RLS" regressions. Currently requires a
Supabase RPC `exec_sql_return_json` that doesn't exist yet; script
self-documents what to add.

The full enforcement-test version (logs in as a fixture user, asserts
cross-tenant reads return empty + cross-tenant writes 403) is still the
right end-state. Needs fixture user setup that wasn't in scope tonight.

### B3. Reports design audit fixes — Phase 2 **[DONE 2026-04-27]**

S4, Q1, Q2, Q3, Q4, N3 all landed; S2 full deferred per A2 note. See
[the audit](docs/audits/2026-04-26-reports-design-audit.md) for the
status banner and per-item commits.

### B4. Idempotency adoption gaps (~1 hr each module)

`withIdempotency()` is used in maintenance + reports. Not used in:
- `app/(app)/testing/acb/actions.ts` (ACB tests on flaky-network jobsites — exact use case)
- `app/(app)/testing/nsx/actions.ts`
- `app/(app)/contacts/actions.ts` (CSV import retry)
- `app/(app)/admin/users/actions.ts`

Each is an opportunity for a duplicate write under retry. Fix incrementally — wrap one action per session, audit-log the same `mutationId` inside the wrapper.

### B5. Defects schema doc cleanup **[DONE 2026-04-27]**

CLAUDE.md "Conventions" section now explicitly calls out defects as the
exception to the `is_active` soft-delete convention.

### B6. Dashboard `as any` / `as unknown as` casts (~1 hr)

[app/(app)/dashboard/page.tsx:167](app/(app)/dashboard/page.tsx:167) and `:247-250` have `as unknown as { name: string }` and `as any` patterns to paper over Supabase's `T | T[]` join cardinality unions. Fix: add a `lib/db/relation.ts` helper that takes `T | T[] | null` and returns `T | null`, replace casts. Also re-run `supabase gen types typescript` so the types are current — they're stale.

---

## Priority C — within 90 days

Improvements that compound but aren't urgent.

### C1. Per-asset technician sign-off in HTML→PDF template

If you ever revisit PDF reports, the legacy DOCX generator includes a "I confirm that the above work has been carried out... Name: <tech> Date: <date>" line at the bottom of every asset's detail section. The new HTML template doesn't have this. Important for compliance documentation.

### C2. Outstanding work-orders count on cover

Legacy DOCX cover shows "Outstanding Work Orders: 4." New HTML template doesn't. Add to template + loader if PDF revives.

### C3. Migration count discipline **[DONE 2026-04-27]**

CLAUDE.md, README.md, ARCHITECTURE.md, LOCAL_DEV.md all updated to point
at `supabase/migrations/` as the source of truth instead of carrying
numeric ranges that bit-rot. CHANGELOG kept as-is (historical record).

### C4. Audit-log enforcement (~30 min once decided)

Some server actions write audit logs, some don't. No middleware enforces it. Options: (a) lint rule that flags any `'use server'` action whose body doesn't call `logAuditEvent`, (b) wrap mutations in a middleware that logs automatically. (a) is simpler.

### C5. Tenant-aware Gotenberg / Browserless decision

If reports become a differentiator: revisit the PDF backend choice. Browserless ~$30/mo, Performance-1x Fly ~$25/mo. Tonight's debug session ate 90 minutes — worth the spend if PDF reports happen.

---

## Done tonight 2026-04-26

For the record:

- ✅ Build fix (`showOverview` dangling reference)
- ✅ Markdown sweep — refreshed CLAUDE.md, README.md, ARCHITECTURE.md, LOCAL_DEV.md
- ✅ HTML→PDF Phase 1 scaffolding (renderer wrapper, data loader, HTML template, API route) — code shipped, deferred behind DOCX-only choice
- ✅ Defects `is_active` bug fix in legacy `generate-and-store.ts` (was an unfired landmine on the existing report path)
- ✅ `npm run check` script + documentation
- ✅ Reports design audit (this evening's biggest deliverable: [docs/audits/2026-04-26-reports-design-audit.md](docs/audits/2026-04-26-reports-design-audit.md))
- ✅ This 30-day plan
- ✅ Fly Gotenberg decommissioned tonight (Royce will run `fly apps destroy` tomorrow per overnight checklist)

## Maintenance discipline

This document is a snapshot. Tomorrow it's already drifting. Two rules to keep it useful:

1. **When you finish an item, cross it off and move it to a "Done 2026-XX" section at the bottom.** Don't delete — the history is useful.
2. **When you discover something new, append it to the right priority bucket.** Don't queue items in your head — they get lost.
