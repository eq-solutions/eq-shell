# Battle tests

A battle test is an overnight agent run that exercises recently-shipped
surfaces hands-off, with the goal of catching regressions, gaps, and UX
papercuts before real users do. Royce kicks one off before stepping away,
reads the morning brief, then turns the brief into the next sprint's
backlog.

This directory holds the canonical procedure (this file) and the
per-run prompt + output bundle (one folder or file pair per date).

## Output convention

Every run produces three artefacts:

| File | Purpose | Audience |
|---|---|---|
| `docs/battle-tests/YYYY-MM-DD-prompt.md` | The exact prompt that kicked the run off | Future Royce — "what did I test that night?" |
| `docs/battle-tests/YYYY-MM-DD-brief.md` | The morning brief — findings, severity, what shipped inline, what's still broken | Royce, first thing in the morning |
| `docs/battle-tests/YYYY-MM-DD-questions.md` | Queued decisions for Royce — one section per question, with options pre-populated | Royce, morning sign-off |

The agent commits all three to its branch. The brief is also pasted into
the PR description so Royce sees it without opening files.

## Branch + PR pattern

- **Branch:** `claude/battle-test-YYYY-MM-DD` (off `main` at start of run)
- **Commits:**
  - One commit per tiny-fix landed inline (so each is independently
    revertable). Conventional commit prefix matching the area
    (`fix(a11y):`, `fix(ui):`, `chore(docs):` etc).
  - One final commit: `docs(battle-test): brief + queued questions YYYY-MM-DD`.
- **PR:** opened against `main`, body = the morning brief, title =
  `Battle test YYYY-MM-DD — N findings, M tiny fixes, K questions`.
- **Do NOT** merge to main without Royce's review. Even tiny fixes
  go through the PR — single sign-off, no exceptions.

## Tiny-fix boundary (agent may land inline, separate commits)

Everything below is in-scope for an overnight run. If the change is
larger than these, queue it as a question instead.

- Typo, capitalisation, spacing, punctuation fixes (visible to users)
- Missing `aria-label` on icon-only buttons
- Dead imports, unused vars (TypeScript already flags these)
- Stale doc references (CLAUDE.md / AGENTS.md mentions a path/route that no longer exists)
- Filename fixes that align with an existing documented pattern (e.g., the Run-Sheet filename fix from PR #82)
- A single missing toast/empty-state for a flow that has them elsewhere
- Convention violations called out explicitly in CLAUDE.md (e.g., "Import" button mis-labelled "Import CSV")

**Hard limits per tiny fix:**
- ≤ 30 lines of code changed
- 0 schema changes
- 0 migration files
- 0 auth-flow files (`proxy.ts`, `app/auth/**`, anything touching `requireUser()` or role helpers)
- 0 RLS policy changes
- 0 changes to email content (customer-facing wording)
- 0 new routes

## Meaningful-question boundary (queue, don't fix)

Anything that requires Royce's judgement. Always queue these instead of
fixing inline:

- Behaviour changes (button now does X instead of Y)
- Schema / migration / RLS / index changes
- Auth, session, MFA, password reset, sign-in/up flow
- Tenant-spanning logic (anything touching `tenant_id` derivation, cross-tenant queries)
- Server-action signature changes
- Stripe / billing / tier-enforcement work (Phase B territory)
- Email subject lines or body wording (customer-facing)
- New routes, new top-level pages, sidebar reshuffles
- Removing or hiding existing features
- > 30 LOC change
- Anything labelled "regression watch" in CLAUDE.md (e.g., MFA AAL loop, secret-scan re. `.next-old/`)
- Anything where the agent isn't confident the fix is correct

For each queued question, write:

```markdown
## [Severity] — [One-line title]

**Where:** file:line / route / surface
**Symptom:** what the agent saw (with reproduction if applicable)
**Why it matters:** user impact, severity reasoning
**Options:**
1. (recommended) Option A — what it implies
2. Option B — what it implies
3. Option C — what it implies
**Recommendation:** which one and why
```

This mirrors the AskUserQuestion pattern so Royce can knock through
the queue in the morning with minimal context-loading.

## Severity scale (for brief + questions)

- **P0** — data loss, security hole, broken auth, customer-facing 500. Wake Royce.
- **P1** — broken feature on the golden path. Block release.
- **P2** — broken feature on an edge path, or a clear UX papercut. Next sprint.
- **P3** — cosmetic, polish, doc drift. Backlog.

## Test credentials (service-role mint)

The agent signs in as two seeded users on the demo tenant via Supabase's
`auth.admin.generateLink()`. No passwords stored anywhere — the agent
just needs the UUIDs.

**Setup** (one-time per environment): `npx tsx scripts/bootstrap-battle-test-users.ts`
provisions `battle-test-admin@eq.solutions` (super_admin on demo) and
`battle-test-portal@eq.solutions` (customer contact, in `report_deliveries.delivered_to`).
Prints the resulting UUIDs to paste into `.env.local` as
`BATTLE_TEST_ADMIN_UUID` / `BATTLE_TEST_PORTAL_UUID`. See
[battle-test-creds-bootstrap.md](../runbooks/battle-test-creds-bootstrap.md).

**At run time** the agent does:

```ts
const { data } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email: process.env.BATTLE_TEST_ADMIN_EMAIL!,
})
// visit data.properties.action_link via the browser MCP
```

The link establishes a Supabase session for that UUID. Demo tenant
membership + role come from `tenant_members`; the agent doesn't need to
think about that.

## Rules of engagement

- Time-box: aim for ~3 hours of agent work. If the agent is still going
  past 4 hours, stop and write the brief with what's been covered.
- Token budget: prefer reading code + targeted dev-server checks over
  running every smoke test. The smoke tests in `tests/lib/reports/` are
  for human review; the agent can run them and inspect the resulting
  `.docx` files only when a specific surface warrants it.
- Real-data caution: the agent runs against the demo tenant
  (`a0000000-0000-0000-0000-000000000001`) and can also read SKS data
  (`ccca00fc-cbc8-442e-9489-0f1f216ddca8`) for cross-tenant leak checks.
  **The agent must NOT write to the SKS tenant.** All write operations
  target the demo tenant only.
- No deploys. No production migrations. No `gh pr merge`. The agent is
  not authorised to land anything on main.
- If the agent encounters an issue it doesn't understand, it queues a
  question with severity P? and moves on. Never escalate, never wake
  Royce.

## Reference: tier framework Phase A surface

If the agent stumbles on the Plan chip in the header — that's expected,
shipped in PR #82. Phase B isn't built yet, so:

- `/admin/billing` 404s — **not a bug**, that's the gate for Phase B
- "Contact sales" mailto link — **not a bug**, that's the intentional Phase A escape hatch
- Tier chip says `Team · Standard` for both SKS and demo — **not a bug**, that's the seeded default

See `docs/tier-framework/phase-b-brief.md` for what's coming.
