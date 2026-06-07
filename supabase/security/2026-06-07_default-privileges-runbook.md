---
title: Secure-by-default DEFAULT PRIVILEGES lockdown — runbook
date: 2026-06-07
status: APPLIED 2026-06-07 (postgres-role lines, all THREE planes — jvkn, ehow, zaap — verified
        born-closed). supabase_admin residual = ACCEPTED 2026-06-07 (Royce): the `FOR ROLE
        supabase_admin` line returns 42501 (permission denied as postgres); left as a documented
        platform residual because it only affects future tables created BY supabase_admin (platform
        internals), not app tables. The dashboard-SQL-editor close-out below is OPTIONAL, not
        required. SKS plane applied on Royce's "finish everything" sign-off as SKS NSW ops
        authority; still confirm with the sks-labour owner on the shared plane.
planes:
  - eq-canonical / control (jvknxcmbtrfnxfrwfimn) — EQ entity
  - sks-canonical (ehowgjardagevnrluult) — SKS entity (coordinate with sks-labour owner)
files:
  - 2026-06-07_default-privileges-control.sql
  - 2026-06-07_default-privileges-sks.sql
---

# Why

New tables on these planes are **born anon/authenticated-open**: the schema-level
`ALTER DEFAULT PRIVILEGES` posture grants full CRUD (public) / SELECT (shell_control,
authenticated) to `anon`/`authenticated` on every table created, unless the migration author
remembers to `REVOKE` + enable RLS. That "open by default" posture is the root cause behind the
recurring incidents:

- 2026-05-31 — `sks_quotes_*` anon-open (sks-canonical)
- 2026-06-07 — `sks_quotes_pricing_*` anon-open (sks-canonical)
- 2026-06-07 — `shell_control.tenant_role_overrides` cross-tenant authenticated SELECT (control)

The per-table patches already closed those tables live. This change flips the **default** to
secure, so the drift gate (`scripts/check-tenant-drift.mjs`, anon-grant invariant) stops being
the *only* thing standing between a new table and exposure. Target end-state: **open by
exception** — a new table that genuinely needs anon/authenticated access gets an EXPLICIT grant
+ RLS policy in its own migration.

> `ALTER DEFAULT PRIVILEGES` only changes tables created **after** it runs. No existing table —
> including the intentional bootstrap reads (`public.organisations`, `public.module_entitlements`,
> `shell_control.eq_schema_registry`) — is touched. `service_role` is never altered.

# Pre-apply verification (do this FIRST, per plane)

Run read-only and confirm the diagnosis still holds before changing anything.

### 1. Census the current default-privilege posture (caveat #2 — find every creator role)

```sql
SELECT pg_get_userbyid(defaclrole) AS creator,
       defaclnamespace::regnamespace AS schema,
       defaclacl
  FROM pg_default_acl
 WHERE defaclobjtype = 'r'
 ORDER BY 1, 2;
```

- **Confirm** the open defaults are `FOR ROLE postgres` and `FOR ROLE supabase_admin` as diagnosed.
- **Stop and re-scope** if a THIRD creator role (or a role-less / `=` default) also grants
  `anon`/`authenticated` — the two `FOR ROLE` lines in the SQL would not cover it.

### 2. Confirm who actually creates tables on each plane

The Management-API channel (`scripts/_mgmt.mjs` → `/database/query`) and the Supabase MCP both
run DDL as **`postgres`**, so the `FOR ROLE postgres` line is the load-bearing one. The
`FOR ROLE supabase_admin` line is belt-and-braces for anything created out-of-band by that role.

# Apply

Apply via Supabase MCP `apply_migration` (or the Management API query channel), **one plane at a
time**, control plane first.

1. **Control plane (EQ):** run `2026-06-07_default-privileges-control.sql` against `jvknxcmbtrfnxfrwfimn`.
2. **SKS plane:** ONLY after sign-off **and** sks-labour-owner coordination, run
   `2026-06-07_default-privileges-sks.sql` against `ehowgjardagevnrluult`. Never point the SKS
   file at an EQ plane or vice-versa.

### ⚠ Known apply-time risk — `FOR ROLE supabase_admin` permission

To `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`, the executing role must be a member of
`supabase_admin` (or superuser). On Supabase, `postgres` is **not** guaranteed to be a member.
If the `supabase_admin` line errors with `permission denied` when run as `postgres`:

- The `FOR ROLE postgres` lines (the ones that matter for normal migrations) will still have
  applied — verify those landed.
- Run the `supabase_admin` line separately via the dashboard **SQL editor** (which may execute
  under a more privileged role), or skip it if the census in step 1 shows `supabase_admin` does
  not actually create tables on this plane.

Because each statement is independent, a failure on the `supabase_admin` line does not roll back
the `postgres` lines — re-check the census after, don't assume all-or-nothing.

# Post-apply proof (caveat #4)

### A. Re-census — anon/authenticated should be gone from the altered defaults

Re-run the step-1 census. For `public` (both planes) and `shell_control` (control plane), no
default-privilege entry should still list `anon=` or `authenticated=` on TABLES.

### B. Born-closed test table — expect ZERO rows

```sql
BEGIN;
  CREATE TABLE public._dpcheck_tmp (id int);
  SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = '_dpcheck_tmp'
     AND grantee IN ('anon', 'authenticated');
ROLLBACK;
```

A new table now carries **no** anon/authenticated grant. (Transaction rolled back — nothing
persists.)

### C. Re-run the drift gate for both planes

```bash
# env: SUPABASE_ACCESS_TOKEN, CONTROL_PROJECT_REF, CANONICAL_INTERNAL_PROJECT_REF, SKS_CANONICAL_PROJECT_REF
node scripts/check-tenant-drift.mjs --anon-only
```

Expect the anon-grant invariant to stay clean. (This change does not retro-fix any existing
table, so any still-open legacy table is unchanged — that's the per-table remediation's job.)

# Rollback

Each SQL file carries a commented symmetric `GRANT` form. Re-running it restores the prior
open-default posture. No data is touched by either direction.

# After it lands

The per-table patches (`sks_quotes_pricing_*`, `tenant_role_overrides_rls_lockdown`) **plus**
this default-privilege fix together close the recurrence loop. Going forward, any new table that
needs anon/authenticated access must declare it explicitly (grant + RLS policy) in its own
migration — see the "Canonical DDL governance" section in `CLAUDE.md`.

# zaap (EQ Field data plane) — censused and APPLIED 2026-06-07

`zaap` (eq-canonical-internal, `zaapmfdkgedqupfjtchl`) was censused after the initial two planes
and carried the **same** footgun (public · postgres + supabase_admin → full anon/authenticated
default). The census showed flipping it is safe: 33 anon/authenticated-granting public tables
exist (EQ Field legacy surface) but **all 33 have RLS enabled**, and `ALTER DEFAULT PRIVILEGES`
only affects FUTURE tables, so none are touched. Their existing exposure stays on the SEPARATE
Field anon burn-down track (`KNOWN_LEGACY_ANON`), unaffected either way.

Applied the `FOR ROLE postgres` revoke on zaap public; verified born-closed. Same `supabase_admin`
residual (dashboard SQL editor). See `2026-06-07_default-privileges-field.sql`. Going forward, a new
Field public table needing anon access must grant it explicitly (new Field work targets `app_data`,
already clean). **The recurrence loop is now closed on all three canonical planes.**
