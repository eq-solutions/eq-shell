# Tenant-plane migrations (`app_data` schema)

These `*.sql` files are the **One Spine** — the single source of truth for every
tenant data plane's schema. The fleet runner (`scripts/migrate-tenants.mjs`)
applies each pending file to **every** tenant in `tenant_routing` via the Supabase
Management API. See `../../SCHEMA-GOVERNANCE.md` for the full model.

## Rules for a new migration

1. **Filename:** `NNNN_short_snake_name.sql`, where `NNNN` is the next zero-padded
   number. Filename order = apply order.
2. **Idempotent + additive-first:** `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT
   EXISTS`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`, etc. The runner may re-run a
   file (a retried Management-API call), and it lands on tenants at different states.
3. **Every new table gets RLS** (`ENABLE ROW LEVEL SECURITY`) and a tenant-scoped
   policy — or, for service-role-only infra tables, the service-role-only grant
   posture (no anon/authenticated grant). A new table with no RLS will trip the guard.
4. **❌ Do NOT write to the ledger.** The runner records this file in
   `app_data._eq_migrations` under its full filename on apply. A migration that does
   its own `INSERT INTO app_data._eq_migrations (...)` creates a duplicate bare-named
   twin row — blocked by `scripts/check-migration-hygiene.mjs`. (Many legacy files
   still carry the self-insert; leave them — the lint only checks newly-added files.)
5. **Never hand-apply.** Merge → dispatch `tenant-migrate.yml` (gated behind the
   `production` environment). No single-tenant SQL via the dashboard/MCP, ever.

## Template

```sql
-- Migration: NNNN_short_snake_name
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   <one line — what shape change this lands and why>
-- Idempotent: yes (safe to re-run; lands on tenants at different states)

-- <your additive, idempotent DDL here>
-- e.g.:
-- ALTER TABLE app_data.some_table ADD COLUMN IF NOT EXISTS new_col text;

-- DO NOT append an INSERT INTO app_data._eq_migrations(...) line.
-- The runner records this migration's ledger row on apply.
```

## Verifying before you raise the PR

- `node scripts/check-migration-hygiene.mjs` — lints your newly-added file(s) for a
  ledger self-insert (no DB access needed).
- The PR's `tenant-migrate.yml` **plan** job posts a read-only matrix of what a real
  apply would do across the fleet. Nothing touches a tenant until a human dispatches
  the gated apply.
