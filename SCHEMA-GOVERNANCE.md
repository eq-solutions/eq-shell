# EQ Tenant Schema Governance — One Spine, One Pipe, One Guard

> **Purpose:** stop tenant schema drift *permanently* — by construction, not discipline.
> Designed 2026-06-03. Royce owns all repos. This doc is the single on-ramp; a new
> session can start cold from here.

---

## The problem we're solving

Each customer gets their **own Supabase database** (a "tenant"). Today: `sks-canonical`
(SKS prod), `eq-canonical-internal` (EQ/seed), with more to come. They're all supposed
to have the **identical schema** (same tables + columns) — only the *data* differs.

They've **drifted apart**. Root cause, found 2026-06-03:
1. Schema was authored in **two repos** — eq-shell `supabase/tenant-migrations/` (the
   `0001–0029` series) **and** eq-intake `sql/` (the `013–048` series).
2. Changes were **hand-applied to one tenant at a time**, so a change could land on SKS
   but not internal (or vice-versa).
3. **Nothing enforced uniformity** — drift could happen and nobody was blocked.

Reconcile once and it just re-drifts. The fix has to close the *mechanism*.

### Schema vs Truth (the mental model)
- **Schema = the shape.** Which tables exist and what columns they have. The *design of a
  filing cabinet*. → must be **identical** on every tenant.
- **Truth = the data.** Each customer's real info inside those tables. The *files in the
  cabinet*. → **different per tenant; precious; never touched by this work.**

**This entire effort changes schema SHAPE and how shape-changes flow. It never touches tenant data.**

---

## The model: One Spine, One Pipe, One Guard

```
   ONE SPINE  ─▶  ONE PIPE  ─▶  ONE GUARD
   one place      one apply       one check that
   to write       path to ALL     blocks divergence
   schema         tenants         before it merges
```

### 1. One Spine — single source of truth (LOCKED)
- **All tenant schema is authored in ONE folder: `eq-shell/supabase/tenant-migrations/`.**
- eq-intake **stops authoring tenant schema** (keeps only the intake engine).
- Migrations are **idempotent + additive-first** (`ADD COLUMN IF NOT EXISTS`, etc.).

> **eq-shell is a CODE REPO, not the control database.** It is NOT joining the control
> plane. It simply hosts the migration *files* + the runner + the guard. The layers:
>
> ```
>   CONTROL PLANE  = a DATABASE (eq-canonical): the tenant list, auth, routing
>          │  "who are all my tenants?"  (tenant_routing)
>          ▼
>   TENANT PLANES  = DATABASES (sks-canonical, eq-internal, future customers)
>
>   eq-shell       = a CODE REPO that operates the above + holds the migrations
> ```

### 2. One Pipe — single apply path (RULE LOCKED)
- The **only** sanctioned way to change tenant schema: add a migration → a **fleet-runner**
  applies it to **every** tenant in `tenant_routing` (per-tenant transaction, halt-on-failure).
- **Same path for rollout AND new-tenant provisioning** → a new customer's DB is born uniform.
- **RULE (locked, includes Claude): NO hand-applied single-tenant SQL, ever.** That is the
  literal drift generator (it's how migration 048 and the whole 2-systems mess happened).

**How it works:** add migration file → merge → CI runner reads the control plane's
`tenant_routing` for the tenant list → applies the migration to each tenant DB → guard confirms match.

### 3. One Guard — the blocking check
- `eq-shell/scripts/check-tenant-drift.mjs` already exists and is good (fingerprints
  tables/columns/functions/policies + anon-grant invariant + migration-identity).
- **Upgrade it** to also fingerprint **FK constraints + ON DELETE** (the gap that let 048
  slip past it).
- It emits a committed **declarative snapshot** (the canonical "photo"), asserts every
  tenant matches it, and **blocks PR merge on divergence.** It never auto-fixes prod —
  a human writes the catch-up migration (declarative for the *check*, imperative for the
  *apply*: the guarantee without the danger of auto-`DROP` on a live DB).

---

## Canonical target = a RATIONALIZED baseline (not raw SKS)

"Most evolved" ≠ "correct." Adopting SKS-prod's shape as-is would enshrine cruft. Instead:
**production is the *evidence* of what's needed; intent is the *filter* that makes it correct.**
Author **Canonical Schema v1.0** from real columns + the spine model, cleaning accidents.
Bounded — not a 55-table rewrite.

### Column level — SETTLED (all legit, purely additive, zero data loss)
The sks↔internal differences are all real features that just didn't propagate. Canonical
v1.0 = the **union**.

> ⚠️ **Direction corrected 2026-06-03** by reading both live tenants directly: the original
> memo had every delta BACKWARDS. The verified picture is below. (Lesson: verify deltas
> against live DBs, never author from the memo.)

| Who HAS it / who LACKS it | Columns / table | What it is |
|---|---|---|
| **SKS has · EQ lacks** | `licences.cards_credential_id`, `licences.confirmed_at`, `licences.confirmed_by` | EQ Cards compliance link (Rung 3) |
| **SKS has · EQ lacks** | `staff.cards_worker_id` | Cards worker link |
| **SKS has · EQ lacks** | `prestart_checks.status`, `toolbox_talks.status` (+ `public.safety_record_status` enum = `draft/submitted/approved/rejected`) | draft/submitted state |
| **EQ has · SKS lacks** | `eq_intake_rate_limits` table **(+ the two RPCs it needs)** | intake-API rate limiting |

> **Resolved:** `eq_intake_rate_limits` belongs on every tenant. It is live intake infra
> (the api-intake edge function calls `eq_check/eq_increment_intake_rate_limit` around every
> commit), it is additive + zero-data (empty even where present), and SKS already carries the
> two RPCs but not the table — so adding it FIXES a latent break rather than propagating a
> nicety. Latent, not active: the public api-intake endpoint has 0 calls on any tenant today.

### Plumbing level — the REAL cleanup (needs judgment)
- Duplicate `_eq_migrations` ledger rows (`NNN` *and* `NNN.sql` — two runners).
- Inconsistent constraint naming (`assets_site_id_fk` vs `_fkey`), leftover duplicates.
- Fold migration **048** (spine `ON DELETE` normalisation, currently out-of-band in
  eq-intake `sql/`) into the eq-shell lineage.

---

## Next steps (in order)
1. ✅ **Resolved:** `eq_intake_rate_limits` belongs on every tenant (see the column table
   above — live intake infra; SKS missing only the table; latent, not active).
2. ✅ **Fleet-runner is the One Pipe.** `scripts/migrate-tenants.mjs` applies every pending
   migration to every tenant in `tenant_routing` via the Management API (no `exec_sql`
   backdoor), checksum-aware, bounded concurrency, exit 2 on any failure. `provision-tenant.mjs`
   delegates to it, so new tenants are born uniform. CI wires it as the apply path
   (`.github/workflows/tenant-migrate.yml`): PR → read-only `--plan` matrix; **dispatch →
   gated apply** behind the `production` GitHub Environment (one human approve before live DDL).
   Apply is **dispatch-only** (not push-on-merge) so every live DDL run is deliberate and the
   one-time ledger reconcile can run before the first apply. ✅ **`production` environment +
   required reviewer (Royce) created 2026-06-03.**
3. ✅ **Drift-guard fingerprint now covers FK + ON DELETE/ON UPDATE**
   (`check-tenant-drift.mjs`, name-independent so `_fk`/`_fkey` naming isn't false
   drift). Validated read-only against both live tenants: zaap (EQ) and ehow (SKS)
   return an identical FK signature hash — already aligned, now held in place.
4. 🟡 **Catch-up migrations authored** (`0032_canonical_union_columns.sql`,
   `0033_fold_intake_rate_limiting.sql`) — additive + idempotent, grounded in the live
   (corrected) deltas. 0033 also folds eq-intake's out-of-band `029` rate-limit infra into
   the spine so fresh tenants get table **and** RPCs. **Not yet applied** — blocked on Step 5
   ledger reconcile (below); a raw apply would re-run 24 falsely-pending migrations on SKS and
   hard-fail at `0023` (bare `CREATE POLICY` on an existing policy). Apply via the runner only.
5. 🟡 **Ledger reconcile — tooling built, run pending.** Two root causes found 2026-06-03 by
   reading both live ledgers:
   - **Naming split** (`NNN` vs `NNN.sql`): the two historical runners recorded different
     name forms, so canonical files show as falsely pending and duplicate rows accumulated.
     SKS also still carries 24 rows from the out-of-band eq-intake lineage (`013…048`).
   - **CRLF/LF checksum nondeterminism**: migrations applied from a Windows checkout recorded
     CRLF hashes; CI (LF) recomputes different hashes → *phantom* drift (the schema is fine —
     the guard confirms zaap≡ehow). **Not edited files.**
   Fix shipped here: (a) `*.sql text eol=lf` in `.gitattributes`; (b) the runner LF-normalises
   before hashing; (c) **`migrate-tenants.mjs --reconcile-ledger`** — a gated, idempotent,
   dry-run-able normaliser that renames un-suffixed rows → `.sql`, de-dupes, re-stamps the
   LF checksum, and drops the legacy eq-intake rows. Touches only `app_data._eq_migrations`.
   Dry-run verified: ehow → 28 rows reconciled (+5 to apply), zaap → 29 (+4 to apply); both
   land on the canonical 33. **Run order:** merge → dispatch `reconcile_ledger=true` (approve)
   → dispatch apply (approve). ✅ **Reconcile + apply DONE 2026-06-03** — both tenants at the
   canonical 33; `0033` created the previously-missing `eq_intake_rate_limits` table on SKS.
   ✅ **`048` folded** into the lineage as `0034_fold_048_spine_ondelete.sql` (RESTRICT on
   `licences.staff_id` + `contacts.customer_id`; verified both tenants already carry it, so it's
   a no-op there and exists for fresh tenants).
6. 🟡 **Scope-aware guard built; blocking flip GATED on a now-precise worklist.**
   `check-tenant-drift.mjs` gained `--strict-spine`: the **spine** (the 56 tables CREATEd by the
   canonical migrations, derived from the files) is the enforced surface; module/legacy layers
   (`field_*`, the SKS labour/quotes tables) are reported informational. Running it surfaced the
   exact gap between today and an enforceable spine — **175 spine-scoped diffs**, of which:
   - **~165 are RLS policies** the EQ tenant LACKS that SKS has (`tenant_isolation` on nearly
     every spine table). This is the **EQ Field anon-model security debt** (see `KNOWN_LEGACY_ANON`
     / eq-solves-field SECURITY-REMEDIATION) viewed cross-tenant — EQ Field runs as `anon` with
     `USING(true)` instead of per-identity RLS. Closing it = the EQ Field RLS remediation.
   - **5 are real column diffs**: `briefing_actions/briefing_cache/gm_report_periods.tenant_id`
     are `text` on core but `uuid` on SKS (type mismatch); `contacts.customer_id` and
     `licences.licence_number` differ in nullability.
   **The guard ships in informational mode now.** Do NOT flip `--strict-spine` to a required CI
   gate until: (a) the 5 spine column diffs are reconciled (pick canonical type/nullability,
   forward-migrate), and (b) the EQ Field RLS remediation lands so core's spine tables carry the
   same tenant-isolation policies. Then flip to blocking and add the declarative snapshot.

   **North star (Royce, 2026-06-03):** EQ Field is *meant* to run on the SKS tenant. So the
   `field_*` layer is a **provisioning gap to close**, not by-design divergence: perfect EQ Field's
   schema (resolve its own half-migration — old un-prefixed ↔ new `field_*`, live data on both),
   bring it into the spine/module lineage, roll it to the SKS tenant via the One Pipe, then cut
   SKS live. The guard's module-layer reporting becomes the checklist for that rollout.

---

## Locked decisions (do not re-litigate)
- ✅ Source of truth for ALL tenant schema = **eq-shell `supabase/tenant-migrations/`**.
- ✅ **No hand-applied single-tenant SQL, ever** (incl. Claude) — everything goes through the pipe.
- ✅ Canonical target = **rationalized baseline** (union at the column level; clean the plumbing).

_Background detail also in eq-context `ops/decisions.md` (2026-06-02/03) and the eq-intake
session memory (`project_schema_governance`, `project_canonical_spine_map`)._
