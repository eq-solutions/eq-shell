# EQ Architecture V2 — Per-Tenant Data Plane

> **Status:** Active sprint as of 2026-05-24. Replaces the implicit shared-multi-tenant architecture inherited from Phase 1.E.

## Mission

EQ Solutions is built for Royce, because he needs it and it must be done right. From there it scales to SKS NSW (his branch), then beyond. Architecture decisions are made for "done right, done once" — no shortcuts planned to be fixed later, no shared infrastructure that needs to be split apart when the second tenant lands.

Product quality drives adoption. The architecture is the product moat. The canonical layer — a per-tenant operational data foundation that multiple apps consume — is what makes EQ different from every monolithic field-service app in the market.

## Principles

1. **The canonical data layer is the customer's asset.** Each tenant owns their operational data in their own physical database. No shared `app_data`. Period.
2. **The control plane is the platform's responsibility.** Auth, billing, tenant routing, audit of cross-tenant events — these are operator concerns and live in one shared project.
3. **Apps consume canonical via a stable API.** No app should know how the data plane is sharded. They call `canonical-api` with a tenant header; routing happens behind the scenes.
4. **Schema changes apply uniformly.** A migration runner applies every schema change to every tenant data plane in one operation. Drift between tenants is not tolerated.
5. **Provisioning a new tenant is a script.** Onboarding takes minutes, not days. Manual steps are the enemy of the second customer.
6. **Defence in depth.** Per-tenant physical isolation + RLS inside each tenant DB + service-role keys held only in encrypted form + master key only in Netlify env. A single failure mode should never expose cross-tenant data.

---

## Current state (pre-migration)

```
                 ┌──────────────────────────────────────┐
                 │  eq-canonical  (one Supabase project)│
                 │                                       │
                 │  shell_control schema:                │
                 │    tenants, users, module_entitlements│
                 │    user_invites, cards_field_approvals│
                 │    rate_limit_buckets, revoked_sessions│
                 │                                       │
                 │  app_data schema:                     │
                 │    customers, sites, staff, licences, │
                 │    jobs, contacts, intake tables, ... │
                 │    (both EQ and SKS rows colocated,   │
                 │     RLS-isolated by tenant_id)        │
                 └────────────┬────────────────┬─────────┘
                              │                │
                       Browser│ (Supabase JWT) │ Netlify
                              │ direct reads   │ functions
                              ▼                ▼
                     ┌────────────────────────────────┐
                     │ React Shell + Netlify Functions │
                     └────────────────────────────────┘

  ⚠ Both EQ and SKS data physically colocated in one Supabase.
  ⚠ Service-role functions could leak cross-tenant if any query
    forgets to filter by tenant_id (RLS bypass).
  ⚠ A schema migration affects every tenant simultaneously.
  ⚠ A noisy-neighbor query slows every tenant.
  ⚠ Customer security review answer is weak.
```

## Target state (post-migration)

```
                 ┌────────────────────────────────────┐
                 │  Shell control plane               │
                 │  (one Supabase project)            │
                 │                                     │
                 │  shell_control schema only:        │
                 │    tenants                          │
                 │    users, user_invites              │
                 │    module_entitlements              │
                 │    cards_field_approvals            │
                 │    rate_limit_buckets               │
                 │    revoked_sessions                 │
                 │    tenant_routing  ← NEW            │
                 │    audit_log (control-plane events) │
                 └──────────────┬─────────────────────┘
                                │ routing lookups
                                ▼
   ┌────────────────────────────┴────────────────────────────────┐
   │     canonical-api  (Netlify function on Shell)              │
   │     - validates app bearer key                              │
   │     - reads X-Tenant header                                 │
   │     - looks up tenant data-plane URL + service key          │
   │     - opens Supabase client against that tenant's DB        │
   └──┬───────────────┬─────────────────┬────────────┬───────────┘
      ▼               ▼                 ▼            ▼
 ┌─────────┐    ┌──────────┐     ┌──────────┐  ┌──────────┐
 │ eq-     │    │ sks-     │     │ tenantN- │  │ ...      │
 │ canon   │    │ canon    │     │ canon    │  │          │
 │         │    │          │     │          │  │          │
 │app_data │    │ app_data │     │ app_data │  │ app_data │
 │ schema  │    │  schema  │     │  schema  │  │  schema  │
 │  +      │    │   +      │     │   +      │  │   +      │
 │ RLS by  │    │ RLS by   │     │ RLS by   │  │ RLS by   │
 │tenant_id│    │tenant_id │     │tenant_id │  │tenant_id │
 │(defence │    │(defence  │     │(defence  │  │(defence  │
 │in depth)│    │in depth) │     │in depth) │  │in depth) │
 └─────────┘    └──────────┘     └──────────┘  └──────────┘

  ✓ Physical isolation: SKS data lives only in sks-canonical.
  ✓ Service-role functions can only read one tenant at a time.
  ✓ Schema migrations applied via runner across all tenant DBs.
  ✓ Per-tenant region pinning, PITR tiers, performance isolation.
  ✓ Customer security review answer: "your DB, your region."
  ✓ Tenant export = single Supabase dump.
  ✓ Tenant deletion = destroy one Supabase project.
```

---

## The two layers

### Shared control plane (`shell_control` schema in one Supabase project)

Holds anything that:
- Is owned by the platform operator (you), not the customer
- Legitimately requires cross-tenant queries (login by email, billing aggregation)
- Tracks the relationship between the platform and the customer

Tables:

| Table | Purpose |
|---|---|
| `tenants` | Tenant registry (id, slug, name, brand, tier, active, field_org_id) |
| `users` | Global user identity (email unique across tenants) |
| `user_invites` | Pending invitations to join a tenant |
| `module_entitlements` | Per-tenant module enablement |
| `cards_field_approvals` | Cards → Field bridge state |
| `rate_limit_buckets` | Login rate limiting |
| `revoked_sessions` | Pre-TTL JWT revocation |
| `tenant_routing` ← **NEW** | Per-tenant Supabase URL + encrypted service-role key + region |
| `audit_log` | Control-plane events (logins, invites, role changes, tenant provisioning) |

### Per-tenant data plane (one Supabase project per tenant)

Holds everything that represents customer business data. Schema is identical across all tenant DBs (managed by the migration runner).

Tables (in `app_data` schema):

| Table | Purpose |
|---|---|
| `customers` | Customer master |
| `contacts` | Customer contacts |
| `sites` | Customer sites |
| `staff` | Workforce |
| `licences` | Staff licences + qualifications |
| `jobs` | Operational jobs |
| `timesheets` | Time entries |
| `leave_requests` | Leave management |
| `prestart_checks`, `toolbox_talks`, `swms`, `jsa`, `itp`, `incidents` | Safety records |
| `assets`, `schedule_entries` | Service/CMMS records |
| `tenders` | Tender pipeline |
| `intake_*` | Intake framework state |
| `audit_log` | Tenant data mutations (separate from control plane audit) |
| `canonical_events` | Append-only event log for cross-app coordination |

Each tenant DB also gets RLS policies that filter on `tenant_id` matching the JWT's `app_metadata.tenant_id` claim. This is defence in depth — the data is already physically isolated; RLS prevents misrouted requests from accidentally reading data even if they reach the wrong DB.

---

## `tenant_routing` — the key new piece

```sql
CREATE TYPE tenant_routing_status AS ENUM ('provisioning', 'active', 'suspended', 'archived');

CREATE TABLE shell_control.tenant_routing (
  tenant_id uuid PRIMARY KEY REFERENCES shell_control.tenants(id) ON DELETE RESTRICT,
  supabase_url text NOT NULL,
  supabase_anon_key text NOT NULL,
  service_role_key_ciphertext text NOT NULL,  -- AES-256-GCM encrypted
  service_role_key_iv text NOT NULL,           -- 96-bit IV for GCM
  service_role_key_tag text NOT NULL,          -- 128-bit auth tag for GCM
  region text NOT NULL,                         -- e.g., ap-southeast-2
  supabase_project_ref text NOT NULL,           -- Supabase project id (jvkn...)
  status tenant_routing_status NOT NULL DEFAULT 'provisioning',
  provisioned_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- Service-role only. Browser never reads this table.
ALTER TABLE shell_control.tenant_routing ENABLE ROW LEVEL SECURITY;
-- No policies = no access for any authenticated role. Service-role bypasses RLS.
```

**Encryption details:**
- Algorithm: AES-256-GCM (authenticated encryption — tampered ciphertext fails verification)
- Master key: `TENANT_ROUTING_MASTER_KEY` env var on the Shell Netlify project (32 raw bytes, hex-encoded)
- IV: fresh 96-bit value per encryption, stored alongside ciphertext
- Auth tag: 128-bit, stored alongside ciphertext

The master key never leaves Netlify env. A database compromise alone does not expose any service-role keys. A Shell compromise does — but at that point the attacker has all of Shell's other secrets too, so this isn't an additional exposure.

**Key rotation procedure** (annual or on suspected compromise):
1. Generate new master key, add as `TENANT_ROUTING_MASTER_KEY_NEXT` env var
2. Run rotation script: decrypt with current, re-encrypt with next, update rows in transaction
3. Promote `_NEXT` to primary, delete old key
4. Optional dual-key support during the rotation window for zero-downtime

---

## Authentication flows

### Browser → Shell (unchanged from Phase 1.G)

User logs in at `core.eq.solutions/` with email + PIN. `shell-login` validates against `shell_control.users` (global email lookup), sets `eq_shell_session` cookie (HMAC, 7d), returns session payload + Supabase JWT.

The Supabase JWT is signed with `SUPABASE_JWT_SECRET`. The same secret is configured on **every** tenant data-plane Supabase project. So one JWT minted by Shell is verifiable by any tenant DB.

### Browser → tenant data plane (NEW pattern)

The browser **does not talk directly to per-tenant Supabase projects.** All app_data reads/writes go through Shell Netlify functions, which route to the right tenant DB based on the session's `tenant_id`.

Rationale:
- The browser shouldn't know individual tenant DB URLs (information disclosure)
- Tenant routing is centralised, auditable, testable
- The Supabase JWT still works as defence-in-depth inside each tenant DB
- `src/lib/supabaseJwt.ts` continues to exist for `shell_control` reads only (e.g., reading the user's own `module_entitlements`)

Existing browser code that reads `app_data` directly via `createSupabaseClient()` (e.g., `EntityBrowserPage`, `Jobs` module) gets refactored to call `canonical-api` Netlify functions instead. This is mechanical work that happens after the routing layer is built.

### App server → Shell `canonical-api` (NEW pattern)

External apps (Quotes Flask, Service Next.js, future apps) authenticate to `canonical-api` using a bearer key:

```http
GET /.netlify/functions/canonical-api?resource=sites&active=true
Authorization: Bearer <CANONICAL_API_KEY_QUOTES>
X-Tenant: sks
```

The Shell function:
1. Validates the bearer against `CANONICAL_API_KEY_<APP>` env vars (per-app keys)
2. Identifies the calling app from which key matched
3. Looks up `tenant_id` from the `X-Tenant` slug via `shell_control.tenants`
4. Reads `tenant_routing` for that tenant, decrypts the service-role key
5. Opens a Supabase client against the tenant's data plane
6. Runs the query; returns standard envelope response

Keys can be promoted to a `shell_control.app_api_keys` table when there are more than 3-4 apps. For now, env vars are sufficient.

### Cards → Field bridge (refactored)

`cards-approve-staff` currently reads from shared `eq-canonical app_data.staff`. After migration: it routes via `tenant_routing` to read from the SKS tenant's data plane (`sks-canonical app_data.staff`), then writes to Field's own Supabase (`eq-field` or `sks-nsw-labour`'s data store, looked up by `tenants.field_org_id`). Same logic, with the routing call inserted at the read step.

---

## `canonical-api` design

Single Netlify function: `netlify/functions/canonical-api.ts`

### Read

```
GET /.netlify/functions/canonical-api?resource=<r>&tenant=<slug>&...
Authorization: Bearer <key>
X-Tenant: <slug>
```

Resources: `customers`, `contacts`, `sites`, `staff`, `licences`, `jobs`

Filters: `limit` (max 500, default 100), `offset`, `active`, `since` (ISO timestamp for delta sync), `ids` (comma-separated UUIDs)

Response envelope:
```json
{
  "ok": true,
  "tenant": "sks",
  "resource": "sites",
  "total": 24,
  "limit": 100,
  "offset": 0,
  "data": [ ... ]
}
```

Each resource projects only the columns external apps need (no `hourly_rate_cost`, `pin_hash`, etc.). Full projections documented inline in the function source.

### Write (events)

```
POST /.netlify/functions/canonical-api
Authorization: Bearer <key>
X-Tenant: <slug>
Content-Type: application/json

{
  "resource": "events",
  "event": "job.completed",
  "payload": { ... }
}
```

Events append to `app_data.canonical_events` in the target tenant's DB. Apps can poll with `?resource=events&since=<ts>` to pick up changes from other apps. Pull-based, not push-based — avoids the webhook fan-out problem until it's actually needed.

### Errors

All errors return:
```json
{ "ok": false, "error": "<error_code>" }
```

Codes: `auth_failed`, `invalid_tenant`, `tenant_inactive`, `unknown_resource`, `invalid_filter`, `rate_limited`, `internal_error`

---

## Schema migration runner

Single source of truth for tenant data-plane schema: `supabase/migrations/` directory in this repo. Each migration is one SQL file.

The runner (`scripts/migrate-tenants.ts`) reads `tenant_routing`, opens a client against each tenant DB, and applies pending migrations in order. Each tenant DB has its own `_eq_migrations` table tracking which versions have been applied; the runner only applies what's missing.

Migration policy:
- Migrations must be idempotent where reasonable (use `IF NOT EXISTS`, `IF EXISTS`)
- Migrations must be additive-first (add nullable column → backfill → enforce constraint in a later migration)
- Destructive migrations (drop column, drop table) require explicit `--allow-destructive` flag
- Failed migration on one tenant raises an alert and blocks the next deploy until resolved
- Migrations run in parallel across tenants with concurrency limit of 5 to avoid Supabase rate limits

Runner output:
```
Applying 2026_05_25_add_canonical_events to:
  ✓ eq-canonical-internal (1.2s)
  ✓ sks-canonical (1.5s)
  ✗ tradeco-canonical (TIMEOUT after 30s) — manual investigation required
```

---

## Tenant provisioning

Script: `scripts/provision-tenant.ts`

Inputs: tenant slug, tenant name, region (default `ap-southeast-2`), tier (default `pro`), platform_admin_email (for the first user)

Steps:
1. Validate slug is unique in `shell_control.tenants`
2. Call Supabase Management API to create a new project in the requested region
3. Wait for project to reach `ACTIVE_HEALTHY`
4. Configure JWT secret to match `SUPABASE_JWT_SECRET` (so Shell-minted JWTs verify on this DB)
5. Configure Auth settings (disable signups, set redirect URLs if needed)
6. Run all migrations against the new project
7. Encrypt service-role key with `TENANT_ROUTING_MASTER_KEY`
8. Insert `tenant_routing` row with status='provisioning'
9. Insert `tenants` row with the new slug
10. Seed default `module_entitlements`
11. Smoke test: hit canonical-api against this tenant, confirm 200
12. Flip `tenant_routing.status` → 'active'
13. Print summary: slug, supabase_url, supabase_project_ref, initial admin login instructions

Target: tenant provisioned in under 30 minutes (most of that is waiting for Supabase project creation). Hands-on operator time: under 5 minutes.

---

## Migration sequence (current → target)

### Phase 2.B.1 — Foundation
- [x] Mission reset in repo docs
- [x] Architecture doc (this file)
- [x] `shell_control.tenant_routing` table + encryption helpers + routing helper
- [x] No data movement yet — purely additive plumbing

### Phase 2.B.2 — Provisioning + runner
- [x] `scripts/provision-tenant.mjs` (filename `.mjs`, not `.ts` — matches existing scripts/ convention; no tsx dep required)
- [x] `scripts/migrate-tenants.mjs`
- [x] `supabase/tenant-migrations/0001_baseline.sql` — initial schema for tenant DBs (mirrors shared eq-canonical app_data for the 6 frontier tables)

### Phase 2.B.3 — canonical-api + provisioning
- [x] `netlify/functions/canonical-api.ts` with sites, customers, staff, licences, jobs, contacts, events resources
- [x] Provision `eq-canonical-internal` (project `zaapmfdkgedqupfjtchl`, ap-southeast-2)
- [x] Provision `sks-canonical` (project `ehowgjardagevnrluult`, ap-southeast-2)
- [x] Apply baseline migration to both
- [x] Insert routing rows for both (status='provisioning')
- [x] `netlify/functions/tenant-routing-health.ts` — admin probe to verify wiring

### Phase 2.B.4 — EQ internal data migration
- [x] `scripts/sync-tenant-data.mjs --slug=core --dry-run` (verified counts)
- [x] `scripts/sync-tenant-data.mjs --slug=core` committed
- [x] All 43 app_data tables migrated (885 rows total: 50 customers / 30 sites / 26 staff / 100 contacts / 29 licences / 500 schedule_entries / 75 timesheets / 30 prestart / 20 toolbox / 15 leave / 10 tenders)
- [x] Validation: row counts match in target (eq-canonical-internal)
- [x] `tenant_routing.status` = 'active'
- [ ] Refactor browser-side `app_data` reads to go through canonical-api (EntityBrowserPage, Jobs module, TenantHome dashboard, AdminUserList, AdminTenantSettings, AdminEditUser, AdminAuditPage, StorageBrowser)
- [ ] Refactor writers (intake commit RPC, any direct INSERT) to write to tenant DB
- [ ] Smoke test all EQ flows
- [ ] 14-day retention of shared rows for rollback

### Phase 2.B.5 — SKS migration
- [x] Provision `sks-canonical`
- [x] Apply baseline + 0002 schema
- [x] `scripts/sync-tenant-data.mjs --slug=sks` committed (1,644 rows: 525 customers / 52 sites / 50 staff / 1000 assets / 6 quote / 11 quote_line_item)
- [x] Validation: row counts match in target (sks-canonical)
- [x] `tenant_routing.status` = 'active'
- [x] Cards bridge (`cards-approve-staff`, `cards-pending-staff`) refactored to read SKS app_data from sks-canonical via tenant routing
- [ ] Maintenance window scheduled with SKS users (only matters when shell browser pages flip — not for Cards bridge)
- [ ] Smoke test SKS Cards bridge to Field
- [ ] 14-day retention; communicate cutover to SKS team

> **Status note (2026-05-24):** Both tenant routing rows now `active`. Cards bridge (cards-pending-staff, cards-approve-staff) is the first live consumer of the routing layer — when PR #20 merges, those two functions start reading staff + licences from the per-tenant DB. Everything else (browser pages, intake commit RPC) still reads/writes shared `app_data`; that's the next coherent refactor.

### Phase 2.B.6 — Intake writer refactor (multi-session)

> **Status (2026-05-24, post-overnight):** All 5 modules are server-side
> complete. PRs landed: #25 (orchestrator + cards), #28 (service), #29
> (quotes), #30 (core server half), #31 (field). The new
> `/.netlify/functions/intake-commit` orchestrator dispatches every
> table in `TABLE_MODULE` to the correct per-tenant RPC.
>
> **Remaining work** to fully close the cutover and unblock Phase 2.B.7:
>
> 1. **commit-canonical.ts refactor** (Phase 2.B.6.5 below) — the
>    browser-side intake UI still calls `sb.rpc('eq_intake_commit_batch')`
>    directly against shared `eq-canonical`. Until that's switched to
>    `fetch('/.netlify/functions/intake-commit')`, the new RPCs sit
>    unused by the UI. Affects the **core** module most (SimPRO flow);
>    cards/service/quotes/field have no current browser-side intake
>    caller other than this same vendored package.
>
> 2. **Confirm zero direct shared-app_data writers** — see Phase 2.B.7
>    grep checks.

This is the last piece before shared `app_data` can be dropped. It's
intentionally staged because the intake commit path is large and
load-bearing:

- 6 dispatcher + per-module commit RPCs (~25 k chars of plpgsql)
- 5 unwind / rollback RPCs
- Helpers (`_eq_intake_apply_metadata`, `_eq_intake_check_tenant_match`,
  `_eq_intake_load_event_meta`, `_eq_intake_record_committed`)
- Browser-side orchestrator in vendored `@eq/intake-demo`
  (`commit-canonical.ts`) handling cross-batch FK resolution + per-entity
  audit transitions
- Writes span 38 entities across 5 modules (core / field / cards / quotes /
  service)

The audit trail (`shell_control.eq_intake_events` + `_row_audit`) lives
on the control plane and stays put — only the *data* writes need to move
to the tenant data plane.

**Staged plan:** one PR per module, smallest blast radius first. Each PR
ships, gets smoke-tested with a real CSV import in deploy preview, then
merges. Order is by size + risk:

| # | Module | Tables | Migration | PR | Status |
|---|---|---|---|---|---|
| 1 | **cards**   | `licences` | `0005_intake_cards_rpc.sql` + `0006_cards_rpcs.sql` + `0007_cards_profile_rpc.sql` | #25, #26 | ✅ Live (Cards mobile cutover incl. CORS fix #27) |
| 2 | **service** | `assets` | `0008_intake_service_rpc.sql` | #28 | ✅ Live |
| 3 | **quotes**  | `quote`, `quote_line_item`, `quote_status_history`, `quote_attachment`, `scope_template`, `rate_library`, `quote_email_outbox` (7 tables) | `0009_intake_quotes_rpc.sql` | #29 | ✅ Live |
| 4 | **core**    | `customers`, `sites`, `contacts` | `0010_intake_core_rpc.sql` | #30 | ✅ Server live; browser half pending (2.B.6.5) |
| 5 | **field**   | 30 tables: `staff`, `apprentice_profiles`, `buddy_checkins`, `checkins`, `engagement_logs`, `feedback_entries`, `incidents`, `itp_records`, `jsa_records`, `swms`, `prestart_checks`, `toolbox_talks`, `jobs`, `leave_*`, `quarterly_reviews`, `rotations`, `schedule_*`, `site_diaries`, `skills_ratings`, `tafe_calendars`, `tender_*`, `timesheets`, `weekly_reports` | `0011_intake_field_rpc.sql` (dynamic dispatch — single function with `EXECUTE format()`, allow-list in `v_allowed`) | #31 | ✅ Live |

**Per-PR shape (template):**

1. New tenant-plane migration (`supabase/tenant-migrations/000N_intake_<module>.sql`)
   - Copy `eq_intake_commit_batch_<module>` body verbatim from shared
   - Strip `_eq_intake_check_tenant_match` (the tenant DB is single-tenant)
   - Strip audit writes (audit stays on shared via a separate path)
   - Take tenant_id as explicit parameter (service-role has no JWT)

2. New Netlify function `netlify/functions/intake-commit.ts` (built once,
   in PR #1)
   - Session-authed
   - Step 1: insert `shell_control.eq_intake_events` row, status `committing`
     (returns intake_id)
   - Step 2: open tenant data client, call the per-module RPC
   - Step 3: write `shell_control.eq_intake_row_audit` rows
   - Step 4: update intake_events row to `completed` or `failed`
   - If step 2 fails, tenant DB transaction rolls back; step 4 marks `failed`

3. Refactor vendored `commit-canonical.ts` to call the new function
   instead of `sb.rpc('eq_intake_commit_batch', ...)`. Vendor change
   isolated to one branch; eventual upstream push to the eq-intake repo.

4. **Smoke test in deploy preview**: drop a CSV through the Intake UI,
   verify rows land in tenant DB (`SELECT count(*) FROM app_data.<tbl>`
   on the right project), verify audit row in `shell_control.eq_intake_events`
   shows `completed`.

5. Merge. Roll forward to the next module.

**Cross-PR concerns:**
- The dispatcher (`eq_intake_commit_batch`) stays on shared until all 5
  modules have moved. It routes by `eq_schema_registry.module` so it can
  continue to call the OLD per-module RPC for not-yet-migrated modules and
  redirect (via the new Netlify function?) for migrated ones. Alternative:
  flip the dispatcher to always call the Netlify function and let the
  function decide.
- Sync drift between intake and reads continues during the migration. If
  intake is migrated for cards but not for core, new core imports still
  land on shared, and the tenant DB stays stale for core until that module's
  PR ships. Acceptable.

### Phase 2.B.6.5 — commit-canonical browser-side refactor

The vendored `eq-intake/eq-platform/packages/eq-intake-demo/src/canonical/commit-canonical.ts`
still calls `supabase.rpc('eq_intake_commit_batch', ...)` directly
against shared `eq-canonical`. With Phase 2.B.6 server-complete, this
is the final cutover step.

**Scope:**

1. Replace the `sb.rpc('eq_intake_commit_batch', ...)` call inside
   `commitOneEntity` with `fetch('/.netlify/functions/intake-commit', ...)`
   (POST, JSON body matching `CommitBody` in intake-commit.ts).
2. Replace `buildCustomerIdMap()` — which currently reads back from
   `app_data.customers` directly via the supabase client — with a read
   of `fk_lookup` from the orchestrator's response. The 'core' RPC
   (0010) returns this map alongside `committed_count` / `committed_ids`
   for the customers batch specifically.
3. Narrow the `SupabaseLikeClient` interface — `rpc` and the
   `from('customers').select(...)` chain are no longer needed for
   the commit path. Kept only if other consumers still need them.
4. Update `commit-canonical.test.ts` — mock the fetch response instead
   of `sb.rpc`.
5. Backport the change into the upstream `eq-intake` repo once the
   vendored copy is proven (separate session).

**Risk:** Touches the production intake UI. Worth gating behind a
manual smoke before merge (CSV drop in deploy preview → verify rows
land in the right tenant DB + audit row shows `completed`).

### Phase 2.B.7 — Drop shared `app_data`

> **Recon status (2026-05-24, post Phase 2.B.6.5 / commit-canonical
> cutover):**
>
> Grep audit of `.schema('app_data')` usage across `src/` +
> `netlify/functions/`:
>
> | Caller | Disposition |
> |---|---|
> | All `netlify/functions/*` callers (cards-pending-staff, cards-approve-staff, canonical-api, tenant-routing-health, intake-commit, tenant-dashboard, entity-rows) | Use the **tenant** Supabase client via `getTenantDataClientById()`. They read/write per-tenant `app_data`, not shared. ✅ Not a blocker. |
> | `netlify/functions/_shared/supabase.ts` + `tenant-routing.ts` | Boilerplate / configuration; not a runtime caller. ✅ Not a blocker. |
> | `src/pages/EntityBrowserPage.tsx` | Only comments mention `app_data`. Real query goes via `/entity-rows` → tenant DB. ✅ Not a blocker. |
> | `src/modules/jobs/index.tsx` | **🛑 Lone blocker.** Calls `sb.schema('app_data').from('jobs'/customers/sites)` directly on the JWT-authed client against shared `eq-canonical`. List + create + update + delete all routed there. |
> | `scripts/` (sync-*, migrate-tenants, etc.) | Operational scripts that intentionally read shared and write tenant. Allowed. |
>
> **Jobs module options** (need Royce's call):
>
> 1. **Delete the module** — Royce flagged it as "no jobs module?" in
>    Cards-cutover convo and the architecture doc has called it
>    "dormant" since intake-writer planning. Cleanest if unused.
>    Removes `src/modules/jobs/`, the route registration, and the
>    Gate/perm entries.
> 2. **Refactor to tenant DB** — needs a new `/jobs-*` Netlify function
>    family (list / create / update / soft-delete) + an `eq_browse_entity`
>    entry for `'job'`. ~3 endpoints, mechanical. Defers the schema
>    drop by one PR.
> 3. **Mark as known shared reader, defer** — explicitly accept that
>    Jobs keeps reading shared until someone actively uses it, and
>    schedule the schema drop *after* either (1) or (2). Schema drop
>    will fail-fast if Jobs is reached during smoke.

#### Checklist
- [x] Confirm zero netlify/functions readers of shared `app_data`
- [x] Confirm zero browser readers/writers except Jobs
- [x] Confirm zero remaining intake writers against shared (Phase 2.B.6 + 2.B.6.5 done)
- [x] **Jobs module deleted** (PR #36, 2026-05-24) — Royce chose option 1 (delete)
- [x] **Dropped `app_data` schema from shared `eq-canonical`** via MCP after PR #36 merge (2026-05-24). Also dropped 6 dead dispatchers (`public.eq_intake_commit_batch` + its 5 per-module variants). Surviving schemas: auth, extensions, graphql, graphql_public, public, realtime, **shell_control**, storage, supabase_migrations, vault.
- [x] **Hotfix — clean up `app_data` leftovers** (PR after #38, migration `2026_05_24d_post_drop_app_data_cleanup.sql`). The DROP CASCADE missed two artefacts that took prod login down for ~20 min: (a) 12 stale `public.*` functions whose bodies still referenced `app_data.*` tables (e.g. `eq_cards_list_my_licences`, `eq_browse_entity`, the five `_eq_intake_unwind_*`), and (b) `app_data` was still in the project's PostgREST exposed-schemas config. Both made PostgREST's schema-cache load throw `schema "app_data" does not exist` and return 503 on every REST call. Fix: dropped the 12 functions + recreated `app_data` as an empty schema (belt-and-braces) and removed it from the dashboard exposed list. Lesson for future schema drops: the pre-flight checklist also needs to grep `pg_proc.prosrc ILIKE '%<schema>%'` and check the project's PostgREST exposed-schemas list, not just `.schema('app_data')` in source code.
- [x] **Final cleanup — DROP empty `app_data` schema** (2026-05-25, migration `2026_05_25_drop_empty_app_data.sql`). After Royce removed `app_data` from PostgREST's exposed-schemas list in the Supabase dashboard (the manual step that couldn't ship via SQL), the empty schema kept as a belt-and-braces no-op by 24d was dropped via MCP. Pre-flight verified `pg_class` join returned 0 objects in `app_data`. Surviving schemas on shared `eq-canonical`: auth, extensions, graphql, graphql_public, public, realtime, **shell_control**, storage, supabase_migrations, vault.
- [ ] Update CLAUDE.md and runbooks — defer, no urgency
- [ ] Pen test (independent) — needs an external auditor

**🎉 Per-tenant data-plane cutover is complete.** Operational tables live exclusively on per-tenant Supabase projects (eq-canonical-internal, sks-canonical). Shared eq-canonical holds `shell_control` + auth + storage. **Storage stays shared by design** — `licence-photos`, `certificates`, and the `tenant-<uuid>` per-tenant buckets are RLS-isolated via `(storage.foldername(name))[1]::uuid = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid` (verified 2026-05-25). Splitting storage per-tenant would add operational cost without adding isolation — RLS reads the same tenant_id claim the data-plane uses.

---

## Phase 2 close-out (2026-05-25)

**Architecture build complete.** Three sessions ran in sequence:

1. **2026-05-24 morning** — Phase 2.B.7: deleted Jobs module, dropped shared `app_data CASCADE`. Caused a 20-min prod login outage from leftover PGRST artefacts (orphan functions + dashboard exposed-schemas config). Captured fix in `2026_05_24d_post_drop_app_data_cleanup.sql`.
2. **2026-05-24 evening** — Security audit Block 1: 6 headers + CSP (frame-ancestors 'none' on the auth hub), `EQ_SECRET_SALT` fail-loud, rate-limit fail-closed, bcrypt 10 → 12, phone-OTP gated behind `ENABLE_PHONE_OTP=true`. Shipped as PR #40.
3. **2026-05-25** — Security audit Block 2: uniform `400 invalid-reset` on accept-pin-reset (collapses bad-PIN / token-not-found / user-not-found side channel), uniform `403 forbidden` on reset-user-pin, **per-app tenant scope on `canonical-api`** (leaked bearer key no longer hops tenants — Field allow-listed to `{eq, sks, demo-trades, melbourne}`, others remain `'*'` for now until `shell_control.app_tenant_scope` table is built). New repo-root [SECURITY-PATTERNS.md](../SECURITY-PATTERNS.md) — 10 standards every future EQ app inherits. Shipped as PR #42. Final follow-up migration to drop the now-empty `app_data` shipped as PR #43.

**Outstanding (not blocking Phase 3+ work):**

| Item | Owner | Notes |
|---|---|---|
| OPS 1 — `licence-photos` bucket RLS check on eq-canonical-internal | Royce (Supabase dashboard, manual) | Storage policy must enforce `(storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')`. Only thing preventing cross-tenant photo access. |
| OPS 2 — Set `EQ_SECRET_SALT` on eq-solves-service Netlify env | Royce (Netlify dashboard, manual) | **Verified missing 2026-05-25.** `app/api/shell-auth/route.ts` reads `process.env.EQ_SECRET_SALT` and returns `500 misconfigured` if absent. Shell → Service SSO silently breaks until set. Value must match Shell / Field / Cards. |
| Independent pen test | Royce / external auditor | Block 1 + 2 reduced the obvious surface; an independent pass is the right next gate before any external customer touches the suite. |
| Cards mobile smoke (deferred from Phase 2.B.6 sprint) | Royce + Claude paired | Flutter web build is in the runbook; needs a paired live walkthrough to confirm the licence-photo upload round-trips through `cards-api` → tenant storage. |

**Next planned arc:** Field unification — see [FIELD-UNIFICATION-PLAN.md](FIELD-UNIFICATION-PLAN.md). F1 (skeleton + routing) is blocked on Royce's SKS prestart/toolbox port landing first; once that's in, re-run the EQ-only/SKS-only audit and compare SKS `prestart_checks` / `toolbox_talks` shapes against tenant migration `0011_intake_field_rpc.sql`.

**Schema drop checklist** (when ready):
1. Final grep: `Grep "\\.schema\\('app_data'\\)" src/ netlify/functions/` returns ZERO blocking matches (only comments / scripts).
2. Take a shared `eq-canonical` snapshot via Supabase dashboard.
3. `DROP SCHEMA app_data CASCADE` on shared `eq-canonical`
   (jvknxcmbtrfnxfrwfimn). Irreversible without restore.
4. Smoke: open every Shell page in prod; intake CSV upload; Cards
   mobile licence list/upsert; Field admin views.
5. Wait 24h. Check Sentry for any `relation "app_data..." does not
   exist` errors (would indicate a missed caller).

---

## Cutover runbook (Phase 2.B.4 / 2.B.5)

When you're ready to migrate a tenant's data from shared `eq-canonical` to its dedicated data plane:

1. **Smoke-test the routing** (no data movement)
   ```
   curl -i https://core.eq.solutions/.netlify/functions/tenant-routing-health \
     -H "Cookie: eq_shell_session=<platform-admin-session>"
   ```
   Expect every tenant to be `reachable: true` with `table_counts` all zero.

2. **Dry-run the sync** to see what would copy
   ```
   SHARED_SUPABASE_URL=...           \
   SHARED_SUPABASE_SERVICE_KEY=...   \
   CONTROL_SUPABASE_URL=...          \
   CONTROL_SUPABASE_SERVICE_KEY=...  \
   TENANT_ROUTING_MASTER_KEY=...     \
   node scripts/sync-tenant-data.mjs --slug=core --dry-run
   ```

3. **Run the sync for real** — idempotent, safe to re-run
   ```
   node scripts/sync-tenant-data.mjs --slug=core
   ```

4. **Verify counts** in the target
   ```
   curl -i https://core.eq.solutions/.netlify/functions/tenant-routing-health \
     -H "Cookie: eq_shell_session=<platform-admin-session>"
   ```
   Each table should now have rows.

5. **Flip status to active**
   ```sql
   UPDATE shell_control.tenant_routing
   SET    status = 'active'
   WHERE  tenant_id = (SELECT id FROM shell_control.tenants WHERE slug='core');
   ```
   `canonical-api` and `getTenantDataClient` will now serve this tenant.

6. **Smoke-test the live flows** — Cards bridge, Jobs module, dashboards, etc.

7. **14-day rollback window** — shared `app_data` rows for this tenant are preserved. If something breaks, flip status back to 'provisioning'; readers fall back to shared eq-canonical until the issue is fixed.

For SKS specifically: do step 1–3 outside business hours, with the SKS team forewarned. Steps 4–6 are the actual cutover window.

---

## Operations

### Monitoring
- Sentry continues to aggregate errors across all Netlify functions (one project: `eq-shell`)
- PostHog continues to aggregate user analytics (one project)
- Supabase per-project dashboards used directly until tenant count exceeds 5; revisit then

### Backups
- Rely on Supabase built-in daily PITR
- Pro tier: 7-day retention (current default)
- Team tier: 14-day retention + SOC 2 Type II inheritance + SLA (upgrade per tenant when justified by their compliance posture)
- No custom backup pipeline — Supabase's is sufficient

### Tenant deprovisioning (churn)
States in `tenant_routing.status`:
- `active` — normal operation
- `suspended` — Shell returns 402 for this tenant's requests; data preserved
- `archived` — data exported to customer; Supabase project paused (free); routing row retained 90 days; then project destroyed and row deleted

### Key rotation
- Supabase service-role keys (per-tenant): annually, or on personnel change. Re-encrypt and update `tenant_routing` row.
- `SUPABASE_JWT_SECRET`: only on suspected compromise (invalidates all sessions). Rotation procedure: update Shell env + every tenant project simultaneously.
- `TENANT_ROUTING_MASTER_KEY`: annually. Dual-key support during rotation window.

### Incident response
- **Single tenant DB compromised:** scope is one tenant. Restore from PITR. Notify that customer. Other tenants unaffected (this is the entire point).
- **Control plane compromised:** highest impact. Attacker has Shell env access → master key → can decrypt all `tenant_routing` rows → has every tenant's service-role key. Mitigations: minimal services touching `tenant_routing` (audit each one), quarterly security review of those functions, all `tenant_routing` reads logged with calling function + IP.
- **Migration runner failure:** runner halts on first failure, alerts, requires manual resolution before next deploy. Failed tenants are isolated; other tenants remain on the previous schema until the failure is resolved.

---

## Costs

| Tenant | Tier | Cost/mo |
|---|---|---|
| Shell control plane (1 project) | Pro | $25 |
| EQ internal (`core`) | Pro | $25 |
| SKS (`sks`) | Pro initially; upgrade to Team when justified | $25 (→ $599) |
| Each future tenant | Pro by default; Team for enterprise | $25 |

At 10 tenants: ~$275/mo if all Pro, ~$850/mo with one Team-tier customer. Platform infrastructure remains <5% of revenue at expected per-customer pricing.

---

## Risks + contingencies

| Risk | Mitigation |
|---|---|
| Schema drift between tenants | Migration runner is the only sanctioned way to change schema. Manual SQL on a single tenant is a process violation. |
| Migration runner partial failure | Idempotent migrations + per-tenant version tracking. Failed tenant blocks deploys until resolved. |
| Control plane breach exposing all tenants | Master key in Netlify env only; per-tenant service-role keys encrypted; audit every read of `tenant_routing`; quarterly code review of routing-touching functions. |
| Supabase as vendor risk (acquisition, pricing, outage) | Per-tenant model de-risks this — tenant data is standard Postgres, exportable to any Postgres provider. Acceptable lock-in on Auth and RLS syntax. |
| Cost growth at scale | Per-tenant pricing scales linearly. At expected customer ARPU, infrastructure is 2-5% of revenue. Acceptable. |
| Operational complexity at 20+ tenants | Provisioning + migration runner reduce per-tenant operator time to near zero. Monitoring meta-dashboard built when needed. |

---

## What this document is

Source of truth for the architectural direction of EQ Solutions. If you're a contributor (or future Royce), read this first. If a decision in the codebase conflicts with this doc, the doc is wrong or the code is wrong — flag it and pick one.

## What this document is not

A status tracker. Sprint progress lives in commits and PRs, not here. Update this doc when the architecture changes, not when work ships.
