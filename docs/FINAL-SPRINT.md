# Final Sprint — canonical layer to 10/10

One sequenced execution plan to take the per-tenant canonical data layer from
*drifted, half-reconciled, one live security hole* to *identical reproducible
schema across every tenant, single source of truth, every app on the API
boundary, no security holes.*

- **Direction (locked):** [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md) → "Source of truth model".
- **Decisions & rationale:** [CANONICAL-SPRINT.md](CANONICAL-SPRINT.md) — Track A status, Track B decision, the B0 policy SQL, the doc-vs-reality appendix.
- **This doc:** the *what / who / when / done* — sequenced tasks, owners, gates, acceptance criteria.

**Legend** — Owner: 🤖 Claude · 👤 Royce. Gate 🔒 = needs Royce's sign-off before it runs (🔒🔒 = touches live SKS / production Quotes). Status: ✅ done · 🔄 in progress · ⬜ not started · ⛔ blocked.

## You are here (2026-05-30)

| Surface | State |
|---|---|
| EQ (`core`, zaapmf) — proving ground | `0020`/`0021`/`0022` applied + verified. Clean reconciliation done. |
| SKS (`sks`, ehowg) — live | `sks_*` anon/authenticated hole **closed** (B0). Otherwise untouched — Phase C hardening still pending. |
| EQ Quotes (Fly, `eq-quotes-sks`) | On the **service-role** key, smoked clean. |
| SKS `sks_*` overlay | **Hole closed** — `b0_revoke_anon_authenticated_sks_overlay`: anon/authenticated grants revoked, RLS on the 4 tables. |
| Next action | **SKS reversible hardening applied + verified** (anon-exec holes closed, `user_metadata`→`app_metadata`) — awaiting Royce smoke. Next gated: gm/briefing reshape, then the `exec_sql`/vestige drops. |

---

## Phase 0 — Close the live security hole (B0) 🔒

The one urgent item. Order is fixed: swap the key **first**, smoke, **then** revoke — enabling RLS while Quotes is on the anon key would break live Quotes.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| 0.1 | Set the `ehowg` service-role key as eq-quotes Fly secret `CANONICAL_SUPABASE_KEY` (replaces the anon key; no code change — the code already expects this) | 👤 | ✅ done¹ — key on `eq-quotes-sks` | `flyctl secrets list -a APP_NAME` shows it updated |
| 0.2 | Smoke Quotes on the service-role key | 👤 | ✅ smoked clean | typeahead, estimator picker (`sks_staff`), customer create/edit, contact-link add/remove all work |
| 0.3 | Apply `REVOKE ALL … FROM anon, authenticated` + `ENABLE RLS` on the 6 `sks_*` objects (`ehowg`) | 🤖 | ✅ applied + verified | anon/authenticated DML denied; service-role (Quotes) unaffected |
| 0.4 | Verify hole closed (`get_advisors` + anon probe) | 🤖 | ✅ anon/authd=(none); RLS on 4 tables | no anon access; advisors clean |
| 0.5 | Rotate the now-exposed service-role key + re-encrypt its `tenant_routing` row | 👤+🤖 | ⬜ after B0 stable | new key live; Shell `canonical-api` still reaches `ehowg` |

¹ The `flyctl` attempt failed because the example carried a literal `<your-eq-quotes-app>` placeholder and Command Prompt parsed its `< >` as redirection. Corrected form — quoted, real app name, **no angle brackets**:

```
flyctl secrets set "CANONICAL_SUPABASE_KEY=PASTE_KEY_HERE" -a APP_NAME
```

Replace `PASTE_KEY_HERE` with the same key you already have, and `APP_NAME` with the exact name from `flyctl apps list` (or eq-quotes' `fly.toml`). The B0 revoke SQL is in [CANONICAL-SPRINT.md](CANONICAL-SPRINT.md) → "B0 — RLS fix".

---

## Phase A — Finish EQ proving-ground reconciliation 🤖

Internal tenant, additive/idempotent — no gate. Makes EQ reproduce the *full* canonical surface so it can be the drift-gate reference for Phase C.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| A.1 | `0023_intake_infra` — **✅ applied to EQ.** Live orchestrator (`intake-commit.ts`) confirmed the lifecycle is *already* central on jvkn (audit-on-shared / data-on-tenant), so EQ's commit path was already correct. Real delta = the tenant guard/log layer only: `app_data.{eq_intake_rate_limits,api_intake_calls}` + 4 rate-limit/api-log fns, hardened (search_path pinned; RLS app_metadata). Excluded dead `eq_get_intake_health`. SKS vestige cleanup (drop ehowg's local `shell_control.eq_intake_*`, 6-arg overloads; fix its RLS) → Phase C. | 🤖 | ✅ applied + verified | EQ has the tenant intake surface; lifecycle+catalog stay central on jvkn |
| A.2 | `0024_gm_reports` — re-home from `supabase/migrations/` into `tenant-migrations/`, apply to EQ | 🤖 | ⬜ | gm_report tables on EQ with scoped RLS |
| A.3 | `0025_briefing` — `briefing_cache`/`briefing_actions`, apply to EQ | 🤖 | ⬜ | briefing tables on EQ, no `anon USING(true)` |
| A.4 | Confirm EQ reproduces the full surface | 🤖 | ⬜ | EQ has Service + write-RPCs + intake(tenant) + gm + briefing |

---

## Phase B — Tooling + API parity 🤖 (deploys 🔒)

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| B.1 | Rewrite `scripts/migrate-tenants.mjs` thin over the Management API (keyed off `tenant_routing.supabase_project_ref`); checksum-aware | 🤖 | ⬜ | runner applies via Management API; refuses on checksum mismatch |
| B.2 | Drop `exec_sql` from every tenant (root cause of hand-applied drift) | 🤖 | ⬜ 🔒 touches all tenants | `exec_sql` absent; drift gate stops flagging it |
| B.3 | Extend `canonical-api`: `assets`/`asset_test_results`/`asset_defects` (fixes Service's dead asset sync) + `contacts`/`contact-links` resources | 🤖 author; 👤 deploy | ⬜ 🔒 deploy to main | Service asset PUTs land; contact read/write via API |
| B.4 | Run `check-tenant-drift.mjs` EQ↔SKS; capture the diff as the SKS work-list | 🤖 | ⬜ | machine diff = the exact set Phase C must apply |

---

## Phase C — SKS hardening batch (live tenant) 🔒🔒

Apply the EQ-proven set to live SKS — but here the objects already exist *unhardened*, so this **fixes** (revoke / repin search_path / scope RLS), not just adds. Heavily gated.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| C.1 | Confirm PITR / take a snapshot | 👤 | ⬜ | restore point captured |
| C.2 | Apply `0020`–`0023`, `0025` to SKS (revoke anon, pin search_path, `app_metadata` RLS) | 🤖 | ⬜ 🔒 | objects hardened; advisors clean |
| C.3 | `0024` on SKS — needs `tenant_id` add + **backfill** (live data reshape) | 🤖 | ⬜ 🔒🔒 backfill sign-off | gm rows carry tenant_id; RLS scoped |
| C.4 | Smoke SKS (GM reports, Service, intake) | 👤+🤖 | ⬜ | no regressions |
| C.5 | `check-tenant-drift.mjs` green | 🤖 | ⬜ | **EQ ≡ SKS** |

---

## Phase D — Identity unification + retire the silo (Track B) 🔒🔒

Depends on Phase C (parity) and Phase 0 (Quotes already on a safe key). Production Quotes changes — every stage gated, reversible, soaked.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| D.1 | **B1** identity reconcile (no data moves): B `7dee117c` = canonical; C `1eb831f9` → alias row (`shell_control.tenant_aliases`); A `…0002` → vestigial | 🤖 | ⬜ 🔒 | one canonical SKS id; C/A recorded |
| D.2 | **B2** Quotes → `canonical-api` (off the direct `sks_*` client). Staged cutover + soak | 🤖 author; 👤 deploy | ⬜ 🔒🔒 | Quotes reads/writes via API to `ehowg app_data` (tenant B) |
| D.3 | **B3** retire silo: drop `sks_*` views/triggers/raw tables + orphan C — post-soak | 🤖 | ⬜ 🔒🔒 destructive | silo gone; Quotes unaffected |
| D.4 | **B4** decide `organisations` Field model (fold or keep for Field); rewrite `canonical-plugin-contract.md` + `EQ-TENANCY-MODEL.md` to the real hybrid | 🤖 | ⬜ | docs match reality |

---

## Phase E — Close-out (the 10/10) 🤖

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| E.1 | Independent security pass / `get_advisors` clean on all 3 projects | 🤖+👤 | ⬜ | no open advisors |
| E.2 | Update `CLAUDE.md`, `README.md`, runbooks to the final state | 🤖 | ⬜ | docs current |
| E.3 | Wire `check-tenant-drift.mjs` into CI (no future drift) | 🤖 | ⬜ | gate runs on PR |
| E.4 | Definition-of-done checklist all ticked | — | ⬜ | see below |

---

## Sequencing

```
Phase 0  ──────────────────────────────►   urgent, independent
Phase A  ──────────────►                    parallel with 0; EQ internal
              Phase B  ──────────►          needs A as drift reference
                     Phase C  ─────────►    needs A+B; applies to live SKS
                            Phase D  ─────► needs C parity + 0 safe-key
                                  Phase E   last
```

## Gates (nothing past a 🔒 runs without Royce's word)

1. **B0** — confirm Fly swap + Quotes smoke (0.1/0.2) before the revoke (0.3).
2. **A.1 plane-split** — the intake control-vs-tenant design call.
3. **B.2 / B.3** — dropping `exec_sql` on all tenants; deploying `canonical-api`.
4. **SKS batch (C.2)** + **gm backfill (C.3)**.
5. **Track B production** — B2 Quotes cutover, B3 silo drop.

## Definition of done — "10/10"

- [ ] `get_advisors` clean on all three projects; no `anon`/`authenticated` DML anywhere unintended.
- [ ] EQ and SKS `app_data` schemas **identical** — `check-tenant-drift.mjs` green.
- [ ] A brand-new tenant #3 provisions the **full** canonical surface from `tenant-migrations/` alone.
- [ ] Every app consumes via `canonical-api` (Service, Cards, Quotes) — no direct `public.*` pokes.
- [ ] One SKS identity (B); C aliased, A retired/scoped.
- [ ] `exec_sql` gone from every tenant; runner is thin over the Management API.
- [ ] Docs match reality; runbooks updated.
