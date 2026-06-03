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
v1.0 = the **union**:

| Tenant gains | Columns / table | What it is |
|---|---|---|
| **eq-internal** | `licences.cards_credential_id`, `licences.confirmed_by`, `licences.confirmed_at` | EQ Cards compliance link (Rung 3) |
| **eq-internal** | `staff.cards_worker_id` | Cards worker link |
| **eq-internal** | `prestart_checks.status`, `toolbox_talks.status` (+ enum types) | draft/submitted state |
| **sks** | `eq_intake_rate_limits` table | intake-API rate limiting |

> Open question for Royce: confirm `eq_intake_rate_limits` belongs on every tenant
> (the only "infra, not feature" item; the other six are clearly keepers).

### Plumbing level — the REAL cleanup (needs judgment)
- Duplicate `_eq_migrations` ledger rows (`NNN` *and* `NNN.sql` — two runners).
- Inconsistent constraint naming (`assets_site_id_fk` vs `_fkey`), leftover duplicates.
- Fold migration **048** (spine `ON DELETE` normalisation, currently out-of-band in
  eq-intake `sql/`) into the eq-shell lineage.

---

## Next steps (in order)
1. **Royce eyeball:** does `eq_intake_rate_limits` belong on all tenants? (last open column question)
2. ✅ **Fleet-runner is the One Pipe.** `scripts/migrate-tenants.mjs` applies every pending
   migration to every tenant in `tenant_routing` via the Management API (no `exec_sql`
   backdoor), checksum-aware, bounded concurrency, exit 2 on any failure. `provision-tenant.mjs`
   delegates to it, so new tenants are born uniform. CI wires it as the apply path
   (`.github/workflows/tenant-migrate.yml`): PR → read-only `--plan` matrix; push to main →
   gated apply behind the `production` GitHub Environment (one human approve before live DDL).
   **One-time setup owed by Royce:** create the `production` environment with himself as a
   required reviewer, or the apply job runs ungated.
3. ✅ **Drift-guard fingerprint now covers FK + ON DELETE/ON UPDATE**
   (`check-tenant-drift.mjs`, name-independent so `_fk`/`_fkey` naming isn't false
   drift). Validated read-only against both live tenants: zaap (EQ) and ehow (SKS)
   return an identical FK signature hash — already aligned, now held in place.
4. **Write additive catch-up migrations** for the deltas above; apply via the runner only.
5. **Clean the `_eq_migrations` ledger** (dedupe `NNN` vs `NNN.sql`) + fold in 048.
6. **Generate canonical snapshot v1.0**; flip the guard to a **required/blocking** PR check.

---

## Locked decisions (do not re-litigate)
- ✅ Source of truth for ALL tenant schema = **eq-shell `supabase/tenant-migrations/`**.
- ✅ **No hand-applied single-tenant SQL, ever** (incl. Claude) — everything goes through the pipe.
- ✅ Canonical target = **rationalized baseline** (union at the column level; clean the plumbing).

_Background detail also in eq-context `ops/decisions.md` (2026-06-02/03) and the eq-intake
session memory (`project_schema_governance`, `project_canonical_spine_map`)._
