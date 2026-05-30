# Overnight autonomous session — guardrails + queue

Goal: advance **"canonical layer set up + active tenants + associated apps"** as far as is
safe to do *unsupervised*, stage everything that isn't, and leave a clear morning report.
Task detail lives in [FINAL-SPRINT.md](FINAL-SPRINT.md); this doc is the autonomous run's
rules + queue.

## Hard guardrails — non-negotiable, even under "complete all tasks"

**NEVER, unsupervised:**
- ❌ Deploy anything (Netlify / Fly / Cloudflare). "Improve" ≠ "deploy".
- ❌ Push to `main` (production auto-deploys from it).
- ❌ Apply **destructive or live-data** changes to **live SKS** (drops, gm/briefing reshape) — they need a smoke-after only Royce can do. **Stage them.**
- ❌ Apply anything to **jvkn** (the production control plane) — stage it.
- ❌ Touch the `sks_*` silo / Quotes (Track B — needs the Quotes cutover; would break live Quotes).
- ❌ Rotate or alter production auth / secrets.

**ALWAYS:**
- ✅ Work on branch `claude/nostalgic-franklin-788020`; commit incrementally, clear messages.
- ✅ EQ (`zaapmf`, the dev tenant) is the proving ground — apply additive migrations + verify.
- ✅ Verify every claim live via MCP; never trust docs over the DB.
- ✅ Stage gated / live-SKS / deploy / control-plane work as ready-to-run files + a review note.
- ✅ The queue is **finite** — work through it once and stop. No indefinite loop.

## Autonomous-safe queue

1. **Drift-gate EQ↔SKS** (read-only) → the precise parity work-list; author EQ-side fixes for any gaps; confirm `0020`/`0022` parity.
2. **canonical-api resources** — author `assets` / `asset_test_results` / `asset_defects` (fixes Service's dead asset sync) + `contacts` / `contact-links`. Code + tests on branch; **deploy staged**.
3. **Thin `migrate-tenants` runner** over the Management API (keyed off `tenant_routing`); author + test on branch.
4. **Security audit** — `get_advisors` on all three projects + review every SECURITY DEFINER fn + RLS policy; fix the branch-safe findings, report the rest.
5. **Code review** — eq-shell codebase for bugs / security / quality; fix safe ones on branch, report the rest.
6. **Tests** — cover the canonical / token / auth-critical paths.
7. **Docs** — rewrite the two drifted tenancy docs (`canonical-plugin-contract.md`, `EQ-TENANCY-MODEL.md`) to the real hybrid.

## Staged for review (authored, NOT applied)

- SKS **gm/briefing reshape** — ALTER add `tenant_id` + backfill `7dee117c` + swap the anon policies.
- SKS **drops** — `eq_exec_sql`/`_eq_exec_sql`, dead `eq_get_intake_health`, 6-arg commit overloads, vestigial `shell_control.eq_intake_*`.
- **jvkn** — relocate `eq_get_intake_health`; single-source `eq_schema_registry`.
- **Deploys** — canonical-api; any `main` merge / PR.
- **Track B** — Quotes → canonical-api, silo retirement, `organisations` model.

## Morning report

What was applied (EQ + branch commits) · what's staged + why · audit/review findings
prioritised (security → bugs → features) · the exact go-list for Royce.
