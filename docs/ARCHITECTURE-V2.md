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

| # | Module | Tables | Body chars | Why this order |
|---|---|---|---:|---|
| 1 | **cards**   | `licences` (29 rows in EQ) | 2,736 | Smallest. Only one entity. Easy first proof. |
| 2 | **service** | `assets` (1,000 rows in SKS) | 2,490 | One entity. Validates with real-ish data volume. |
| 3 | **quotes**  | `quote`, `quote_line_item`, `quote_status_history`, `quote_attachment`, `scope_template`, `rate_library`, `quote_email_outbox` (6 + 11 rows in SKS) | 3,106 | Multi-table with cross-batch FKs. First non-trivial case. |
| 4 | **core**    | `customers`, `contacts`, `sites` (50/100/30 rows in EQ; 525/0/52 rows in SKS) | 4,540 | Real production data on both tenants. SimPRO import flow exercises this. |
| 5 | **field**   | `staff`, `schedule_entries`, `prestart_checks`, `toolbox_talks`, `swms`, `jsa_records`, `itp_records`, `incidents`, `timesheets`, `leave_requests`, `leave_balances`, `checkins`, `tenders`, `tender_*`, `site_diaries`, `weekly_reports`, `apprentice_profiles`, `skills_ratings`, `feedback_entries`, `rotations`, `buddy_checkins`, `quarterly_reviews`, `engagement_logs`, `tafe_calendars`, `schedule_change_logs`, `leave_approval_logs` (≈26 tables) | 8,319 | Largest module. Last to migrate because it's the riskiest. |

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

### Phase 2.B.7 — Drop shared `app_data`
- [ ] Confirm zero readers (`git grep "schema\\('app_data'\\)"` in src/ and
      `netlify/functions/`)
- [ ] Confirm zero writers (intake writer fully migrated — Phase 2.B.6 done)
- [ ] Jobs module refactor (last direct-`app_data` reader, dormant —
      bundle with one of the above PRs)
- [ ] Drop `app_data` schema from shared `eq-canonical`
- [ ] Update CLAUDE.md and runbooks
- [ ] Pen test (independent)

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
