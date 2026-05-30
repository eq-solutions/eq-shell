# Canonical Sprint — schema reconciliation + tenancy unification

> **Status:** active, 2026-05-30. **Track A** (schema drift) is executing on the EQ
> proving-ground tenant. **Track B** (tenancy/identity unification) is a
> **decision awaiting Royce's sign-off — no DB changes until approved.**
> Direction is locked in [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md) "Source of truth model".
>
> **Execution checklist:** [FINAL-SPRINT.md](FINAL-SPRINT.md) — sequenced Phase 0–E tasks,
> owners, gates, and definition of done. This doc holds the *decisions & rationale*.

EQ Quotes (v81) is **live in production** and is treated as a fixed consumer in every
plan below. Nothing here breaks its read/write contract without an explicit, staged,
reversible step.

---

## The two tracks, and how they interlock

- **Track A — schema reconciliation.** Make the per-tenant `app_data` schema identical
  and reproducible across every tenant (codify the out-of-band objects, harden the
  security regressions). *Executing now on EQ (`core`).*
- **Track B — tenancy & identity unification.** Resolve the three conflicting "SKS"
  identities and two tenancy models onto the one canonical model. *Decision pending.*

**Interlock:** Track B **gates** the customer/contact / `sks_*` / Quotes parts of Track A
(migrations `0026` + the Quotes cutover). The Service module (`0020`/`0021`, already
applied to EQ) and the other independent modules are unaffected.

---

# Track B — Tenancy & identity (DECISION — needs sign-off)

## Verified reality (live, 2026-05-30 — not from docs)

Supabase org `sqjyblkiqonyrdobaucn`. Three projects:

| Project | ref | Holds |
|---|---|---|
| eq-canonical | `jvknxcmbtrfnxfrwfimn` | **Control plane** (`shell_control`: tenants, routing, auth, intake audit) + a vestigial `public.organisations` Field model + GM-report tables in `app_data`. **No canonical customer/contact/site/staff tables.** |
| sks-canonical | `ehowgjardagevnrluult` | SKS per-tenant `app_data` plane (tenant `7dee117c`) **+** a bespoke `public.sks_*` customer/contact silo (org_id `1eb831f9`, **RLS off**) that EQ Quotes reads/writes directly. |
| eq-canonical-internal | `zaapmfdkgedqupfjtchl` | EQ/`core` per-tenant `app_data` plane (tenant `dcb71d03`, 49 tables, real data). *Not SKS, not empty.* |

**Two tenancy models coexist in `jvkn`:** `shell_control.tenants` (SKS = `7dee117c`) **and**
`public.organisations` (SKS = `0000…0002`). Unlinked — only the slug string `"sks"` in common.

**Three SKS identities:**
- **B `7dee117c…`** — defined in `jvkn shell_control.tenants`, used in `ehowg app_data`. The real, cross-project canonical id. Routed B→`ehowg` by `shell_control.tenant_routing`.
- **C `1eb831f9…`** — `ehowg public.sks_*` `org_id`. **Orphan**: no `organisations`/`tenants` row defines it in any project.
- **A `0000…0002`** — `jvkn public.organisations`. Vestigial; nothing downstream references it.

**The bridge:** `ehowg public.sks_contacts` / `sks_contact_links` are VIEWS whose
SECURITY-DEFINER `INSTEAD OF` triggers write into `app_data.contacts` /
`app_data.contact_customer_links` with tenant_id **hardcoded to the literal `7dee117c`**
(C is never read). `sks_customers` (518) / `sks_staff` (19) are plain tables that do
**not** propagate to `app_data` (hence app_data.customers=125 ≠ sks_customers=518).

**Security hole (confirmed):** `ehowg public._sks_contacts_raw`, `_sks_contact_links_raw`,
`sks_customers`, `sks_staff` + the two views — **RLS disabled, `anon` holds SELECT**. The
publishable/anon key can read all SKS customer/contact/staff data.

**Docs vs reality:** `canonical-plugin-contract.md` (shared-DB + RLS + `user_metadata` +
"tenant") and `EQ-TENANCY-MODEL.md` (per-tenant DB + singular table names) **contradict
each other and both contradict the live hybrid** (control-plane project + per-tenant
`app_data` planes governed by `tenant_routing`, entities in `app_data` not `public`,
`app_metadata` not `user_metadata`). Full disagreement list in the appendix.

## The decision

The prompt's three options were framed against the **stale shared-DB contract model**.
Mapped onto the **actual** (and already-locked) per-tenant model:

- **Option 1 (register a pointer)** — partly redundant: the B→`ehowg` pointer already
  exists as `shell_control.tenant_routing`. The real gap is that `organisations` (A) is a
  second, unlinked model. Extending A reinvents what `tenants`+routing already do.
- **Option 2 (consolidate into eq-canonical/jvkn)** — **rejected as written.** Adding
  entity tables to the shared `jvkn` and migrating SKS data there **re-centralizes the data
  plane**, contradicting ARCHITECTURE-V2 (per-tenant physical isolation). Consolidation is
  right; the *target* is wrong.
- **Option 3 (fix RLS only, defer)** — the RLS fix is mandatory, but "defer the linkage"
  leaves three live identities for SKS. Do the RLS fix as step 0, don't stop there.

**Recommended: converge everything onto the canonical model you already chose** —
`shell_control.tenants` + per-tenant `app_data` (id **B `7dee117c`**) — and retire the
silo via the Quotes→canonical-api cutover already approved, *not* by centralizing data.

### Staged plan (each stage stops for sign-off)

| Stage | What | Risk | Quotes impact |
|---|---|---|---|
| **B0 — RLS fix (security, do first)** | Close the `ehowg public.sks_*` anon hole. Policies presented below for approval. | Low *if* Quotes' key is confirmed first | None if Quotes uses service-role; needs a key swap first if it uses anon |
| **B1 — Identity reconcile (no data moves)** | Declare **B `7dee117c`** the canonical SKS id. Record **C `1eb831f9`** as a legacy alias (a mapping row, e.g. `shell_control.tenant_aliases`). Decide **A `0000…0002`**: map to B or mark vestigial. | Low | None |
| **B2 — Quotes → canonical-api** | Migrate Quotes off the direct `sks_*` client onto `canonical-api` (customers/contacts/sites/staff via the API → `ehowg app_data`, tenant B). *(Already Royce's decision.)* Add the contact/contact-link read+write resources `canonical-api` lacks. | Medium (touches live Quotes) | Staged cutover + soak; reversible |
| **B3 — Retire the silo** | Once Quotes is on the API: drop the `sks_*` views/triggers/raw tables + the orphan org_id C. | Destructive — post-soak, gated | None (Quotes already moved) |
| **B4 — Retire the org model + fix docs** | Decide `jvkn public.organisations` + Field tables (fold into the tenant model or keep for Field only). Rewrite both tenancy docs to the real hybrid. | Low | None |

### B0 — RLS fix for approval (do NOT apply yet)

**CONFIRMED 2026-05-30 (Quotes code + live grants):** Quotes uses the **anon key** for `ehowg`
(`eq-quotes-port/app/config.py` + `extensions.py`: *"anon key works (RLS disabled); upgrade to
service_role once available"*). And the hole is worse than read exposure — **`anon` AND
`authenticated` hold full DML (`SELECT,INSERT,UPDATE,DELETE,TRUNCATE`)** on all six `sks_*`
objects. The publishable key can **modify or wipe** live SKS customer/contact/staff data. High
urgency, but Quotes is on that key — so the fix is **key-swap-first**, each step gated:

1. **Provision** the `ehowg` service-role key → set it as the eq-quotes Fly secret
   `CANONICAL_SUPABASE_KEY` (replacing the anon key). *Royce, via `flyctl secrets set`.* The code
   already expects this ("upgrade once available") — **no code change**.
2. **Smoke Quotes** — customer/contact typeahead (read) + customer/contact upsert (write) still
   work on the service-role key.
3. **Then** apply on `ehowg` (service_role bypasses RLS; anon/authenticated denied):
   ```sql
   DO $$ DECLARE t text;
   BEGIN
     FOREACH t IN ARRAY ARRAY['_sks_contacts_raw','_sks_contact_links_raw','sks_customers',
                              'sks_staff','sks_contacts','sks_contact_links']
     LOOP EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', t); END LOOP;
   END $$;
   ALTER TABLE public._sks_contacts_raw      ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public._sks_contact_links_raw ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.sks_customers          ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.sks_staff              ENABLE ROW LEVEL SECURITY;
   -- sks_contacts / sks_contact_links are VIEWS — the REVOKE is their protection
   -- (RLS can't be enabled on a view); the service-role Quotes client keeps full access.
   ```

No `ENABLE RLS` before steps 1–2 land. Presented for sign-off, not applied.

---

# Track A — Schema reconciliation (executing)

**Mechanism (settled):** Supabase Management API (`apply_migration`); `scripts/check-tenant-drift.mjs`
as the enforced no-drift gate; retire the legacy `exec_sql` runner. EQ (`core`) is the
proving ground — apply there first, then SKS in a reviewed batch.

| Migration | Module | Status |
|---|---|---|
| `0020_service_cmms` | Service tables | ✅ applied + verified on EQ |
| `0021_service_ppm_rpcs` | Service PPM fns (hardened: service_role + pinned search_path) | ✅ applied + verified on EQ |
| `0022_canonical_write_rpcs` | customer/site/contact write RPCs | ⬜ authored next |
| `0023_intake_infra` | intake rate-limit/api-log/event-lifecycle + **`user_metadata`→`app_metadata` RLS fix** | ⬜ |
| `0024_gm_reports` | re-home + **add tenant_id + backfill + scoped RLS** (live has neither) | ⬜ needs backfill sign-off |
| `0025_briefing` | briefing cache/actions + **fix `anon USING(true)` RLS** | ⬜ |
| `0026_sks_overlay` | **GATED by Track B** — secure/capture vs retire depends on the B decision | ⛔ blocked on B |
| tooling | thin Management-API runner · `exec_sql` drop · `canonical-api` asset + contact resources | ⬜ |

**SKS is untouched.** All EQ applies so far are additive/idempotent on the internal tenant;
the sensitive revoke/backfill/drop pass against SKS is held for an explicit reviewed batch.

---

## Sign-off gates (nothing past a gate runs without Royce's word)

1. **Track B direction** — approve "converge on model B; reject centralize-into-jvkn". ← *here*
2. **B0 RLS** — confirm Quotes' key, approve the policy/grant set.
3. **0024 gm_reports backfill** — the one live-data reshape on EQ.
4. **SKS batch** — applying the hardened set (revokes/drops) to the live SKS tenant.
5. **B2 Quotes cutover** + **B3 silo retire** — production Quotes changes.

## Appendix — doc-vs-reality disagreements
1. Docs say "tenant"/`tenants`; live `jvkn` has BOTH `shell_control.tenants` AND `public.organisations` (neither doc mentions the org model).
2. Docs put customers/contacts/sites/staff in `jvkn`; live `jvkn` has none — they live in per-tenant `app_data` (`ehowg`=SKS, `zaapmf`=core).
3. Docs imply `public` schema; live entities are in `app_data`.
4. `EQ-TENANCY-MODEL.md` uses singular table names; live tables are plural.
5. `canonical-plugin-contract.md` = shared-DB+RLS; `EQ-TENANCY-MODEL.md` = per-tenant-DB. Live = hybrid (neither).
6. `supabase_project_ref` framed as optional branding; live routing is `shell_control.tenant_routing` (and `organisations` has no such column).
7. Docs assert RLS gates everything; `ehowg public.sks_*` has RLS off + anon SELECT.
8. `canonical-plugin-contract.md` says RLS reads `user_metadata`; canonical is `app_metadata` (Phase 1.F).
