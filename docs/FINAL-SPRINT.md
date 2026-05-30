# Final Sprint — canonical layer to 10/10

The one sequenced plan to finish the job: take the per-tenant canonical data layer
from *drifted + half-reconciled* to **identical reproducible schema across every
tenant, single source of truth, every app on the API boundary, zero security holes.**

- **Re-grounded 2026-05-30** against live DB state (`list_migrations` + `get_advisors`
  on all three projects) — this doc reflects what is *actually* applied, not docs.
- **Direction (locked):** [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md) → "Source of truth model".
- **Decisions & rationale:** [CANONICAL-SPRINT.md](CANONICAL-SPRINT.md) — Track A/B, B0 SQL, doc-vs-reality.
- **This doc:** the *what / who / when / done* — sequenced, owners, gates, acceptance.

**Legend** — Owner: 🤖 Claude · 👤 Royce. Gate 🔒 = needs Royce's sign-off · 🔒🔒 = touches live SKS / production Quotes. Status: ✅ done · 🟡 built, not shipped · 🔄 in progress · ⬜ not started.

The three projects (org `sqjyblkiqonyrdobaucn`):

| Project | ref | Role |
|---|---|---|
| eq-canonical | `jvknxcmbtrfnxfrwfimn` | **Control plane** — `shell_control` (tenants, routing, auth, intake audit). **Never touched unsupervised.** |
| sks-canonical | `ehowgjardagevnrluult` | **SKS — LIVE tenant** (`7dee117c`). `app_data` + bespoke `public.sks_*` Quotes silo. PITR on. |
| eq-canonical-internal | `zaapmfdkgedqupfjtchl` | **EQ / core — dev tenant.** The proving ground + drift reference. Apply freely. |

---

## Snapshot — verified live 2026-05-30

| Surface | State |
|---|---|
| EQ (`zaapmf`) — proving ground | `0020`–`0025` + `0027` applied + verified. Full canonical reference. Clean 15-migration lineage. |
| SKS (`ehowg`) — live | B0 hole closed; reversible hardening applied; gm/briefing anon closed; `0027` vestige + `exec_sql` backdoor dropped. Service CMMS came via an **older path** (`ppm_tables`/`ppm_report_rpcs`), not the branch `0020`/`0021` → drift remains. 50-migration lineage with hand-applied duplicates. |
| `jvkn` — control plane | Untouched this session. **Advisor review still outstanding** (see Phase 2). |
| canonical-api asset fix | **Built + committed** (`8aa4345`) — not deployed. Service asset sync stays dead until it ships. |
| EQ Quotes (Fly `eq-quotes-sks`) | On the **service-role** key (B0). Smoked clean. Exposed key **awaiting rotation**. |
| Branch `claude/nostalgic-franklin-788020` | 3 commits (`f20023e`, `8aa4345`, `e6bf3a8`), tree clean. Awaiting `/code-review`. |

## Done this session — don't redo

- ✅ **B0** — `sks_*` overlay anon/authenticated DML revoked + RLS on (verified deny-all).
- ✅ **SKS reversible hardening** — anon-exec revoked on PPM/intake-guard/helpers, `search_path` pinned, `user_metadata`→`app_metadata` RLS.
- ✅ **gm/briefing anon hole closed** on SKS (access is service-role-only via Netlify fns — safe).
- ✅ **EQ** `0020`–`0025` applied + verified (Service CMMS, PPM RPCs, canonical write RPCs, intake guard/log, gm, briefing).
- ✅ **`0027`** — dropped intake vestiges (generic + 6-arg commit overloads, `_eq_intake_*` helpers, tenant lifecycle fns, `eq_list_module_entities`, dead `eq_get_intake_health`) **+ the `eq_exec_sql`/`_eq_exec_sql` backdoor** on BOTH tenants. Live 8-arg per-app commits verified intact.
- ✅ **canonical-api asset fix built** — `assets`/`asset_test_results`/`asset_defects` GET+PUT.
- ✅ **Security review of the `eq_*` write RPCs** — see below: **accepted, not a hole.**

---

## Security review — 2026-05-30 advisor sweep

### Reviewed & accepted (by design — document, don't "fix")

- **`eq_*` canonical write/archive/delete RPCs (`0022`) are SECURITY DEFINER + `authenticated`-executable — and that is SAFE.** Every mutate path carries `AND tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)`; upserts derive tenant from the JWT, never a parameter. A signed-in user from tenant A calling `eq_delete_customer('<tenant-B-uuid>')` matches zero rows. The advisor `authenticated_security_definer_function_executable` WARNs on this family are **expected**. ⚠️ *Invariant this rests on:* `mint-supabase-jwt` must always set a correct, server-controlled `app_metadata.tenant_id`. Guard it in Phase 2.
- **gm/briefing + `sks_*` tables show `rls_enabled_no_policy` (INFO) — this is the intended deny-all.** RLS on + no policy = no anon/authenticated access; the only readers are Netlify service-role functions (which bypass RLS). Confirms B0 + the gm/briefing close are holding. *Reconcile:* `0024`/`0025` migration comments claim `app_metadata` policies that don't exist — correct the comments to "service-role-only / deny-all by design" so the next reviewer isn't misled.

### Residual findings — real, prioritised

| P | Finding | Where | Fix | Gate |
|---|---|---|---|---|
| **P1** | `mint-supabase-jwt` is the single trust root for every `eq_*` RPC's tenant scoping — audit it sets `app_metadata.tenant_id` server-side with no client override path | Shell fn | Code audit + test; document the invariant | 🤖 |
| **P2** | 5 `_sks_*` SECURITY DEFINER fns (`_sks_contacts_insert/update/delete_fn`, `_sks_contact_links_insert/delete_fn`) executable by anon + authenticated | SKS `public` | `REVOKE EXECUTE … FROM anon, authenticated` — they're the silo's INSTEAD-OF trigger fns (no-arg; error if RPC-called), so revoke is safe + doesn't touch Quotes (service-role + triggers fire regardless) | 🔒 (Track B-adjacent, but safe) |
| **P3** | `app_data.touch_updated_at` has a mutable `search_path` | SKS | `ALTER FUNCTION … SET search_path = 'app_data','public'` | 🤖 |
| **P3** | `tenant-logos` public bucket has a broad SELECT (listing) policy | EQ `storage` | Narrow the policy to object-read (drop list) | 🤖 |
| **P?** | **`jvkn` (control plane) advisors NOT reviewed** — output too large to read this session | `jvkn` | Run `get_advisors` + page the saved file; triage | 🤖 |

---

## Phase 1 — Ship what's already built 🔒

The fastest distance to value. Nothing new to build — gate, deploy, smoke.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| 1.1 | `/code-review` the branch (point it at `canonical-api.ts`) | 👤 | ⬜ | findings triaged; safe ones fixed on branch |
| 1.2 | Confirm Service's asset sync resolves **parent→child** order (asset upsert → read `canonical_id` → pass as `asset_id` on test-result/defect; `*_id`/`visit_id`/`parent_asset_id` are canonical UUIDs, not external_ids) | 🤖+👤 | ⬜ | Service writes assets then children using returned ids |
| 1.3 | Deploy `canonical-api` (merge to `main`) | 👤 | ⬜ 🔒 | Service asset PUTs land (no `unknown_resource`) |
| 1.4 | Rotate the exposed `ehowg` service-role key **+ re-encrypt its `shell_control.tenant_routing` row** (Shell `canonical-api` decrypts it — must update together) | 👤+🤖 | ⬜ 🔒🔒 | new key live; Shell still reaches `ehowg`; Quotes Fly secret updated |

---

## Phase 2 — Residual security hardening 🤖

The findings above. All branch-safe except where gated.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| 2.1 | **P1** — audit `mint-supabase-jwt`: `app_metadata.tenant_id` is server-set, no client override; add a test | 🤖 | ⬜ | invariant proven + documented in code |
| 2.2 | **P3** — pin `touch_updated_at` search_path (SKS) | 🤖 | ⬜ 🔒 (live, additive) | advisor WARN clears |
| 2.3 | **P3** — narrow `tenant-logos` bucket SELECT policy (EQ) | 🤖 | ⬜ | listing denied; object URLs still resolve |
| 2.4 | **jvkn advisors** — read the saved sweep, triage, fix branch-safe | 🤖 | ⬜ | jvkn findings recorded + actioned/accepted |
| 2.5 | **P2** — author `REVOKE EXECUTE` on the 5 `_sks_*` fns (stage; ships with Track B or as a standalone safe revoke) | 🤖 author; 👤 apply | ⬜ 🔒 | anon/authenticated cannot execute them |

---

## Phase 3 — EQ ↔ SKS parity 🔒🔒 (live SKS)

Make the two `app_data` schemas identical + reproducible. EQ is the reference; SKS gets the deltas.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| 3.1 | Run `check-tenant-drift.mjs` EQ↔SKS → the exact machine delta (esp. Service CMMS: EQ `0020`/`0021` vs SKS `ppm_*`) | 🤖 | ⬜ | diff captured as the SKS work-list |
| 3.2 | Reconcile SKS Service CMMS to the `0020`/`0021` canonical shape (additive; converge the older `ppm_*` path) | 🤖 author; 👤 apply | ⬜ 🔒🔒 | SKS Service objects ≡ EQ |
| 3.3 | **gm/briefing `tenant_id` reshape** on SKS — ADD `tenant_id` + backfill `7dee117c` + swap UNIQUE to `(tenant_id, period_code)`; **ship with** `upload-gm-report.ts` (`onConflict: 'tenant_id,period_code'`, set `tenant_id`) | 🤖 author; 👤 deploy | ⬜ 🔒🔒 | gm rows carry tenant_id; uploads still work; RLS scoped |
| 3.4 | **EQ gap-fills** — `contact_customer_links` table + `approve_safety_record`/`submit_safety_record` (JWT-scoped like `0022`) + helpers (`_set_updated_at`, `eq_set_imported_at`). Exclude control-coupled `eq_schema_registry_one_current` | 🤖 | ⬜ | EQ has the surfaces SKS has; advisors clean |
| 3.5 | Smoke SKS (GM reports, Service, intake) | 👤+🤖 | ⬜ | no regressions |
| 3.6 | `check-tenant-drift.mjs` green | 🤖 | ⬜ | **EQ ≡ SKS** |

---

## Phase 4 — Tooling + migration ledger 🤖

Kill the root cause of drift (hand-applied SQL) and reconcile the ledger.

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| 4.1 | Thin `migrate-tenants` runner over the **Management API** (keyed off `tenant_routing`), **checksum-aware** — applied migration *names* already diverge from branch filenames (`gm_reports_module` vs `0024_gm_reports`), so match by checksum not name | 🤖 | ⬜ | runner applies + refuses on checksum mismatch |
| 4.2 | Reconcile the migration ledger — map applied names ↔ `tenant-migrations/` files; record the canonical set | 🤖 | ⬜ | one authoritative ledger; no phantom diffs |
| 4.3 | **`shell_control.eq_intake_*` retirement** — the trigger-wired `eq_intake_template_track_*` fns + events/templates/registry tables `0027` deliberately skipped (vestigial on tenants; live event log is on jvkn) | 🤖 author; 👤 apply | ⬜ 🔒 | subsystem gone from tenants; jvkn audit log intact |
| 4.4 | Wire `check-tenant-drift.mjs` into CI | 🤖 | ⬜ | drift gate runs on PR |

---

## Phase 5 — Track B: identity unification + retire the silo 🔒🔒

Production Quotes. Depends on Phase 1 (safe key) + Phase 3 (parity). Every stage gated, reversible, soaked. Full rationale in [CANONICAL-SPRINT.md](CANONICAL-SPRINT.md).

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| 5.1 | **B1** identity reconcile (no data moves): B `7dee117c` = canonical; C `1eb831f9` → alias; A `…0002` → vestigial | 🤖 | ⬜ 🔒 | one canonical SKS id |
| 5.2 | **B2** Quotes → `canonical-api` (off the direct `sks_*` client) — staged cutover + soak | 🤖 author; 👤 deploy | ⬜ 🔒🔒 | Quotes reads/writes via API to `ehowg app_data` |
| 5.3 | **B3** retire silo: drop `sks_*` views/triggers/raw tables (+ the `_sks_*` fns from P2) — post-soak | 🤖 author; 👤 apply | ⬜ 🔒🔒 | silo gone; Quotes unaffected |
| 5.4 | **B4** decide `organisations` Field model; rewrite `canonical-plugin-contract.md` + `EQ-TENANCY-MODEL.md` to the real hybrid | 🤖 | ⬜ | docs match reality |

---

## Phase 6 — Close-out (the 10/10) 🤖

| # | Task | Owner | Status | Done when |
|---|---|---|---|---|
| 6.1 | `get_advisors` clean (or every WARN accepted + documented) on all 3 projects | 🤖+👤 | ⬜ | no open unexplained advisors |
| 6.2 | Update `CLAUDE.md`, `README.md`, runbooks to final state | 🤖 | ⬜ | docs current |
| 6.3 | Definition-of-done checklist all ticked | — | ⬜ | see below |

---

## Sequencing

```
Phase 1  ───────────────────►              ship built work; independent, do first
Phase 2  ──────────►                        branch-safe hardening; parallel with 1
      Phase 3  ──────────────►              live SKS parity; needs EQ ref + gates
            Phase 4  ─────────►             tooling; needs 3's ledger truth
                  Phase 5  ──────────►      Track B; needs 1 (key) + 3 (parity)
                        Phase 6            last
```

## Gates — nothing past a 🔒 runs without Royce's word

1. **1.3 / 1.4** — deploy canonical-api; rotate the exposed key + re-encrypt routing.
2. **2.2 / 2.5** — live-SKS additive pin; the `_sks_*` revoke.
3. **3.2 / 3.3** — SKS Service reconcile; gm/briefing backfill (live-data reshape).
4. **4.3** — `shell_control.eq_intake_*` retirement.
5. **5.x** — all of Track B (Quotes cutover, silo drop).

## Definition of done — "10/10"

- [ ] `get_advisors` clean (or every WARN explicitly accepted + documented) on all three projects.
- [ ] `jvkn` advisors reviewed (not just the two tenants).
- [ ] EQ ≡ SKS `app_data` — `check-tenant-drift.mjs` green.
- [ ] A brand-new tenant #3 provisions the **full** canonical surface from `tenant-migrations/` alone, via the thin runner.
- [ ] Every app consumes via `canonical-api` (Service, Cards, Quotes) — no direct `public.*` pokes; `sks_*` silo retired.
- [ ] One SKS identity (B); C aliased, A retired.
- [ ] `exec_sql` gone from every tenant (✅); runner is thin over the Management API; ledger reconciled.
- [ ] Exposed `ehowg` service-role key rotated + routing re-encrypted.
- [ ] Docs (`CLAUDE.md`, `README.md`, tenancy docs) match reality.
