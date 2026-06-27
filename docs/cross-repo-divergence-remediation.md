# Cross-repo divergence — audit + remediation plan

From a 2026-06-27 cross-repo audit (migrations↔live, shared packages/vendored, seam
contracts). **Most of the suite is in sync.** This captures what drifted, the strategies
to stop it recurring, and the specific fixes. Nothing here was applied to a database; the
only code change is the Field permission fix (committed, build-verified, not deployed).

## What's NOT drifting (so we don't chase ghosts)
- **Role model** (`@eq-solutions/roles` v2.3.0): in sync across consumers AND CI-guarded —
  `scripts/check-perm-sync.mjs` fails the build if the local copy drifts from the package.
  **This is the model to copy everywhere.**
- **Session cookie shape**: in sync; consumers tolerate unknown fields.
- **Package versions**: only minor cosmetic skew (tokens v1.3.2 vs 1.3.3 = logo tokens
  only; ui `#main`(1.9.0) vs `v1.8.0`).
- **Seam docs**: mostly current (IDENTITY-MODEL.md carries an accurate superseded banner).

## The three drift types + specific findings

### 1. Database ↔ code (migrations) — the biggest structural gap
- **Root cause:** the drift gate (`scripts/check-tenant-drift.mjs`) CHECK 3 (migration
  identity) **doesn't cover jvkn** (the control plane) at all — it only runs against the
  two tenant planes, reads the wrong ledger table (`app_data._eq_migrations`; jvkn uses
  `supabase_migrations.schema_migrations`), and is non-blocking. So **jvkn has zero
  repo↔live migration coverage.**
- **Behavioural cause:** DDL applied by hand (dashboard/MCP) that's never committed.
- **Specific divergences:**
  - `2026_06_16_cards_claim_explicit_user_id.sql` — STALE: applied, then reverted
    out-of-band (`fix_claim_invite_drop_p_user_id_overloads`, never committed); live is
    the safe 1-arg version; a replay would re-introduce the wrong 2-arg signature.
  - Tenant migrations `0142` / `0144` — unapplied on zaap (EQ), applied **out-of-band** on
    ehow (SKS); `0144` is an ungoverned `CREATE TABLE`. zaap is behind ehow.
  - jvkn ledger is unreliable both ways — phantom hand-applied entries + committed files
    recorded under different names.
  - eq-service's standalone 106-file migration folder targets the **deleted** `urjh`
    project — orphaned (live Service runs on ehow via the One Pipe). A trap for the next
    person.

### 2. Shared code (packages / vendored)
- **Vendored `eq-intake/eq-platform/packages` — a real BIDIRECTIONAL fork (HIGH):**
  - `eq-schemas` licence schema is STALE in eq-shell's copy (missing the Cards
    claim/provenance fields: `holder_email`, `asserted_by`, `verification_status`,
    `claim_status`; `licence_number` still required).
  - `eq-intake` is forked AHEAD in eq-shell's copy (the `calibration-cert` skill the source
    lacks, which the equipment module imports) → a naive re-vendor DELETES a feature and
    breaks the build. **The two need a merge, not a one-way copy.**
- Roles / tokens / ui: in sync or minor cosmetic skew.

### 3. App-to-app contracts (seams)
- **Field `extra_perms` on the handoff — ✅ FIXED (`25c079b`).** Was: a worker entering
  Field via the Shell silently lost their security-group permissions.
- **Service `canonical-sync` field names — LIVE DATA LOSS (eq-service side):**
  `canonical-sync.ts` sends `manufacturer`/`location`/`tested_by_name`/`title`/`external_*_id`
  but the gateway's writable set expects `make`/`location_in_site`/`tested_by_external`/
  `description`/`asset_id` — mismatched fields are silently dropped, so SKS asset/test/defect
  syncs land with missing make, location and site/asset links. Confirmed vs live ehow schema.
- **Dead contract code (cleanup):** orphaned Service `/auth/shell-bridge` route +
  `signBridgeToken` stub; Field's dead `verifyShellToken` HMAC branch.

## Strategies to eliminate divergence (prioritized)
1. **Extend the auto-guard you already have.** The role-sync CI check (assert copy == source,
   fail on drift) is the model — apply "copies must match" gates wherever a contract is
   duplicated, and extend the drift gate to the control plane.
2. **One pipe, enforced, no exceptions.** Every schema change is a committed migration —
   never the dashboard/MCP. Once the control-plane check is blocking, a hand-change fails
   the next build loudly.
3. **Generate shared field lists from one source.** The Service/asset bug is two sides
   hand-typing names. Publish the canonical-api contract as generated types (extend
   Service's existing types-drift guard); consumers import them → a rename becomes a
   compile error, not silent data loss.
4. **Make vendored code a real dependency** (submodule or published package) after merging
   the current two-way fork.
5. **Delete dead/stale code** — it's divergence-in-waiting.
6. **Scheduled suite-wide drift report** — extend the existing 3-hourly drift gate to also
   report jvkn repo↔live, package versions, and seam contract checks.

## The keystone: drift gate → control plane (design — build carefully, do not rush)
Closing the jvkn coverage gap is the single highest-leverage fix, but the ledger is
unreliable, so a naive ledger-diff would be noisy. Build it like this:
- Target jvkn against `supabase_migrations.schema_migrations` AND both jvkn repo dirs
  (`eq-shell/supabase/migrations` + `eq-cards/supabase/migrations`).
- Prefer an **object-level** check (do the functions/tables the recent repo migrations
  define exist live in the expected form?) over a ledger-name diff — the same approach as
  the function-grant CHECK 6 already in the gate.
- Ship it **REPORT-ONLY first.** It will light up on the existing divergence (2026_06_16,
  the out-of-band entries); reconcile those, THEN flip to blocking. **Never ship it
  blocking onto existing red** — that just trains people to ignore the gate.

## Remediation checklist
| Item | Where | Who / how | Status |
|---|---|---|---|
| Field `extra_perms` on handoff | eq-shell | me | ✅ done (`25c079b`) |
| Service `canonical-sync` field names | eq-service | cross-repo prompt | ready |
| Reconcile `2026_06_16` (commit the revert, supersede the stale file) | eq-shell migrations + jvkn | me draft → human apply via One Pipe | pending |
| Apply `0142`/`0144` to zaap; backfill ehow ledger | tenant planes | human / governed dispatch | pending |
| Merge the vendored `eq-intake` fork (both directions) | eq-shell ← eq-intake | careful merge | pending |
| Drift gate → control plane (report-only) | eq-shell `scripts/` | me (careful, per spec above) | spec'd |
| Delete dead bridge/HMAC code | eq-shell + eq-service | cleanup | pending |
| Retire orphaned eq-service migration folder | eq-service | cleanup | pending |

**The database-side items (migration reconciliation, applying 0142/0144) need a human in
the loop** — they touch live schema through the governed pipe, and getting them wrong is
exactly the kind of thing that's hard to catch after the fact. They're documented here so
they're done deliberately, not blind.
