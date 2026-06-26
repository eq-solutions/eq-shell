# Sprint: Privacy & User-Data Hardening — close the gaps before we scale users

**Goal:** make EQ Shell's user-data surface safe to put in front of more users and
tenants. Close four verified findings from the 2026-06-26 privacy posture audit —
two of them **unauthenticated** PII reads on the live control plane — and add the
one systemic guard that would have caught them. Every task names the exact file,
the proven pattern it copies, and a testable acceptance check.

**Source:** full privacy posture audit, 2026-06-26 (no branch diff — whole-surface
review). Four findings cleared independent false-positive verification at
confidence ≥8; one privacy-consistency gap (below the vuln bar) is folded into
Phase 3 because it's a one-line fix on the same surface.

**Progress (2026-06-27, branch `claude/determined-edison-d6f176`):**
- ✅ **Phase 2.1** (crm-write authz gate) — implemented + committed in this branch.
- ✅ **Phase 3.1 / 3.2** (`is_private` filters on the Cards compliance export + the
  approval-time licence sync) — implemented + committed.
- ⏸️ **Phase 1.1** (token-exchange membership gate) — deferred pending the
  field-slug↔tenant_id mapping; a hasty gate risks a false-403 outage on the live
  EQ+SKS Field SSO path. Next careful pass.
- 🚧 **Phase 0** (revoke anon on the two jvkn SECDEF functions) — blocked: the anon
  grant is load-bearing for EQ Field's browser reads (verified), so it's a sequenced
  cross-repo cutover, not a one-line revoke. Awaiting the approach decision below.
- *Not deployed.* Branch work only; every apply/deploy stays gated on Royce.

---

## Read first — governance & deploy constraints

- **Nothing here deploys without Royce's explicit say-so.** These are auth- and
  data-exposure changes; per global rule, *auth changes require explicit approval
  before deployment*. This doc is the plan, not a deploy trigger.
- **jvkn control-plane fixes are migrations**, committed under
  `supabase/migrations/` with the `2026_06_*.sql` naming (same tree as
  `2026_06_25b_eq_get_org_licences_backfill.sql`). The apply mechanism for jvkn
  (governed run vs. reviewed Supabase-MCP hotfix-then-commit, the PR #450/#451
  precedent) is **Royce's call** — flagged in *Decisions* below. Do not hand-apply
  silently.
- **The eq-field tasks are a different repo and separate PRs.** Never cross-deploy
  EQ ↔ anything.
- **Build gate = `pnpm run build`** (runs `build:packages` first). Drift gate must
  stay green.

## Findings → tasks at a glance

| # | Finding | Auth needed? | Severity | Phase |
|---|---|---|---|---|
| V1 | `eq_get_org_licences` anon-executable, no caller guard — worker name/email/phone/licence to the public anon key | **None** | High (10/10) | 0 |
| V2 | `eq_field_get_worker_summary` anon-executable, no caller guard — emergency contacts + right-to-work to anon | **None** | High (9/10) | 0 |
| V3 | `token-exchange` mints a Field token for any tenant slug with no membership check — cross-entity (EQ→SKS) reach | Authed user | High (9/10) | 1 |
| V4 | `crm-write` runs every CRM mutation (incl. hard deletes/merges) with no permission gate | Authed user | High (9/10) | 2 |
| P1 | `cards-export-licences` ignores the worker `is_private` flag in the compliance export | Authed manager | Privacy gap (3/10 as vuln) | 3 |

---

## Phase 0 — Stop the unauthenticated bleed  *(P0 — but a sequenced cross-repo change, NOT a one-line revoke)*

**Correction — verified in eq-field, 2026-06-26.** Both functions are called from the
**EQ Field browser with the anon key**, not a service-role or authenticated path:
`scripts/people.js` → `_fetchCanonLicences()` (`eq_get_org_licences`, line ~1098) and
`_fetchWorkerSummary()` (`eq_field_get_worker_summary`, line ~1151) both send
`apikey: CANONICAL_ANON_KEY` + `Authorization: Bearer CANONICAL_ANON_KEY`. (The
`2026_06_25b` migration comment claiming a "service-role path" is wrong — the code uses
anon for both.) Consequences:

- **A blind `REVOKE … FROM anon` breaks the SKS "Cards Record" panel + canonical
  licence list in production.** The anon grant is load-bearing.
- **An in-function caller guard alone doesn't help** while the caller is anon —
  `auth.uid()` is NULL for the anon key, so any `org_memberships … auth.uid()` guard
  returns zero rows, which is the same outage.
- Therefore V1/V2 can only be closed by **moving Field's read to an authenticated path
  first**, then revoking anon. This is a sequenced eq-field + jvkn change.

| # | Task | Repo / Files | Size | Acceptance |
|---|---|---|---|---|
| 0.1 | **Stand up an authenticated read path** for the two canonical reads. *Robust:* a Field server-side proxy (Field netlify function → jvkn via service-role, after verifying the Field session + org). *Lighter:* pass a user-scoped jvkn JWT from the browser. (See Decision — approach.) | eq-field `netlify/functions/*`, `scripts/people.js` | M–L | Both reads return the same data via the new path with **no anon key** in the request |
| 0.2 | **Cut `people.js` over** — `_fetchCanonLicences` / `_fetchWorkerSummary` use the new path; drop the `CANONICAL_ANON_KEY` RPC calls | eq-field `scripts/people.js:1098,1151` | S | Cards Record panel + licence list still render on SKS; network shows no anon RPC to jvkn |
| 0.3 | **Revoke anon + add caller guard** — *lands only AFTER 0.1/0.2 deploy.* `REVOKE EXECUTE … FROM anon` on both; add an org-scoped caller guard (member or admin of `p_org_id`, per Decision). If 0.1 uses the service-role proxy, also `REVOKE … FROM authenticated` (service-role-only). `eq_get_org_licences` is `LANGUAGE sql` — wrap/convert to plpgsql to add the guard + `RAISE EXCEPTION` | new `supabase/migrations/2026_06_27_revoke_anon_pii_functions.sql` | S–M | `has_function_privilege('anon',…)=false` for both; the new Field path still works; an authed non-member gets exception/0 rows |
| 0.4 | **Inventory every anon consumer** before the revoke — confirm nothing else (eq-cards, any other surface) calls these RPCs with anon | grep eq-cards / eq-field / eq-shell | S | Caller inventory documented; only the migrated Field path remains |

**Sequencing is load-bearing: 0.1 → 0.2 deploy to Field, *then* 0.3 on jvkn.**
Reversing the order is a production outage on the SKS worker panel. The anon exposure
stays open until 0.3 lands, so keep the cutover window short and treat 0.1/0.2 as the
priority. This is the one phase that crosses into eq-field — separate repo, separate
PR, separate deploy.

---

## Phase 1 — Close the cross-tenant token mint

`token-exchange.ts` takes `tenant_slug` from the request body and validates it only
against a static allow-list (`ALLOWED_FIELD_TENANT_SLUGS`), never checking the caller
is a member of that tenant — unlike `select-tenant.ts:85` / `switch-tenant.ts:73`,
which both do the membership check. Downstream, eq-field binds the Field session and
SKS data-JWT to the request slug, ignoring the verified JWT's `tenant_id`.

*Status: 1.1 deferred — see Progress. The membership gate needs the field-slug↔tenant_id
mapping resolved first (the field slugs `eq/demo-trades/melbourne/sks` are not the same
as shell tenant slugs, e.g. `core`≠`eq`), or a wrong map produces false 403s and breaks
EQ Field SSO. Implement against the `field_tenant_slug` precedent from PR #370.*

| # | Task | Files / Reuses | Size | Acceptance |
|---|---|---|---|---|
| 1.1 | **Gate the Field mint on membership** — before minting `aud='field'`, resolve the requested slug and reject (403 `not-a-member`) if the caller isn't a member; prefer deriving the slug from `session.tenant_id` (as `mint-tenant-jwt.ts:75` does) over trusting `body.tenant_slug`. Mirror `switch-tenant.ts` | `netlify/functions/token-exchange.ts` (reuse `getUserMemberships`) | S | `POST {aud:'field',tenant_slug:<not-a-member>}` → 403; member request still succeeds; same-tenant Field iframe still loads past "Authorising…" |
| 1.2 | **(eq-field, separate PR) Defense-in-depth** — `verify-shell-token` rejects when `body.tenantSlug` ≠ the verified JWT's `app_metadata.tenant_id` on the Supabase-JWT path | eq-field `netlify/functions/verify-pin.js:568` | S | A handoff whose slug doesn't match the JWT tenant is rejected by Field; legit same-tenant handoff unaffected |
| 1.3 | **Regression guard** — assert no token minter trusts a request-supplied tenant/slug without a membership check (the audit cleared the others; lock it in) | `token-exchange.ts` tests / a smoke assertion | S | Test fails if a minter scopes to a request slug the caller isn't a member of |

---

## Phase 2 — Authorization on CRM mutations  *(✅ implemented in this branch)*

`crm-write.ts` verified a session and scoped by `session.tenant_id` (tenant isolation
was fine), but had **no permission gate** on any of ~17 actions — including
`delete_site`/`delete_contact` (hard deletes) and `merge_customers`/`merge_contact`.
Its single-record siblings gate the same ops (`entity-actions.ts:120` `entity.delete`,
`entity-patch.ts:120` `entity.edit`, `entity-insert.ts:67` `entity.create`).

| # | Task | Files / Reuses | Size | Acceptance |
|---|---|---|---|---|
| 2.1 | ✅ **Per-action permission gate** at handler entry, before the switch — a `PERM_BY_ACTION` map routes `add_*`→`entity.create`, `update_*`/`archive_*`/link/unlink→`entity.edit`, `delete_*`/`merge_*`→`entity.delete`; unknown action → 400, deny → 403 | `netlify/functions/crm-write.ts`, `_shared/permissions.js` (`can`) | M | A non-manager (`employee`/`apprentice`/`labour_hire`) POSTing `delete_site`/`merge_customers` etc. → 403; a `manager` still succeeds |
| 2.2 | **Manager-path regression** — the Customers hub already calls `crm-write` for delete/merge | `CustomersHubPage.tsx` (delete_site/delete_contact/merge_contact) | S | A manager can still delete a site, delete a contact, and merge contacts from the UI |

---

## Phase 3 — Privacy consistency + systemic guard  *(3.1/3.2 ✅ implemented in this branch)*

| # | Task | Files / Reuses | Size | Acceptance |
|---|---|---|---|---|
| 3.1 | ✅ **Honor `is_private` in the compliance export** — added `.eq('is_private', false)` to the licence query, matching `staff-canonical-licences.ts:85` / `staff-org-roster.ts:83` | `netlify/functions/cards-export-licences.ts` | XS | A worker's private licence (number + front/back photos) is excluded from the compliance ZIP |
| 3.2 | ✅ **Same filter on approval sync** (both code paths) — private licences no longer propagate into `app_data.licences` when a worker is approved | `netlify/functions/cards-approve-staff.ts` | XS | Approving a worker does not copy their private licences into the Field plane |
| 3.3 | **Drift-gate CHECK for anon SECDEF** — flag any `anon`-executable `SECURITY DEFINER` function on jvkn whose body lacks an `auth.uid()` / `is_org_admin` / `app_metadata` reference (the existing gate only inspects *table* grants, which is how V1/V2 slipped past) | `scripts/check-tenant-drift.mjs` | M | Gate fails on a synthetic anon SECDEF PII function with no caller guard; passes once Phase 0 lands |

---

## Recommended one-sprint cut

**"Lock the doors before the open house":** Phase 0 (0.1–0.3) + 1.1 + 2.1 + 3.1 +
3.2 + 3.3. That closes every verified exposure and installs the guard that prevents
the anon-SECDEF class from recurring — all small-to-medium, no auth-flow redesign.
(2.1 + 3.1 + 3.2 are already done in this branch.)

Fast-follow (next PR, can slip): **1.2** (eq-field defense-in-depth, separate repo)
and **1.3 / 2.2** regression locks.

## Sequencing

- **0.x first and alone** — it's the only unauthenticated exposure; ship the Field
  cutover (0.1/0.2) then the jvkn revoke (0.3). Reversing the order breaks Field.
- **Phase 1.1 and Phase 2.1 are independent** eq-shell function changes — one PR or
  parallel, either order.
- **3.1 / 3.2** are trivial; bundle them with the Phase 1/2 PR.
- **3.3 after 0.x** — the new CHECK should pass against the already-fixed functions,
  not fail on them.
- **1.2 last** — different repo, different deploy, gated on its own review.

## Definition of done

- V1/V2: Field's canonical reads run over an authenticated path (no anon key in the
  request); `anon` EXECUTE = false on both functions (verified live); authed non-member
  gets no data; the SKS Cards Record panel + canonical licence list still render.
- V3: cross-tenant `token-exchange` returns 403; same-tenant Field iframe loads.
- V4: non-manager CRM mutation returns 403; manager flows unaffected.
- P1: private licences absent from export and from approval sync.
- `pnpm run build` green; drift gate green (with the new 3.3 CHECK); no regression
  in Field iframe, roster, Cards approval, or Customers hub.
- Each fix lands via PR; jvkn migrations committed under `supabase/migrations/`.

## Decisions for Royce

- **Phase 0 approach (blocks 0.1)** — *server-side Field proxy* (Field netlify
  function calls jvkn via service-role after verifying the Field session; tightest —
  lets us revoke anon AND authenticated, no canonical key in the browser at all) vs.
  *authenticated jvkn JWT from the browser* (lighter, but needs a user-scoped canonical
  token available in Field at read time, which it may not currently hold). **Recommend
  the proxy.** This determines the eq-field work.
- **Who does the eq-field side (0.1/0.2)** — that's a separate repo + deploy; I can
  draft it in an eq-field session, or hand a spec to whoever owns Field.
- **jvkn apply mechanism** for 0.3 — governed run, or reviewed Supabase-MCP
  hotfix-then-commit (the PR #450/#451 precedent)? P0 security; a hotfix apply may be
  justified once Field is cut over, but it's your call.
- **Caller-guard strictness (0.3)** — restrict `eq_get_org_licences` /
  `eq_field_get_worker_summary` to org **admins** only, or any **active member** of
  the org? (Affects which Field roles can read the worker panel.)
