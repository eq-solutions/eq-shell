# nspbmir → ehow ETL (teams + leave) — DRY-RUN tooling

Cross-DB **data** movement from the SKS standalone Field database (nspbmir,
`nspbmirochztcjijmcrx`, wide `public.*`) into the SKS canonical data plane (ehow,
`ehowgjardagevnrluult`, normalized `app_data.*`). Two surfaces: **teams** and
**leave**.

> This is **data** movement, **not** a tenant DDL migration. It does **not** go
> through `tenant-migrate.yml` / `supabase/tenant-migrations`. It mirrors the
> existing one-off sync scripts (`sync-tenant-data.mjs`,
> `sync-field-to-canonical.mjs`).

## Status: DRY-RUN / report-only

The runner **defaults to `--dry-run`** and **never writes** on this branch. It
reads source + target and reports what *would* land. `--apply` is a hard-gated
no-op stub (`exit 3`) — Royce wires + runs the write path later, after reviewing
the dry-run report and creating the target tables.

## What moves

| Source (nspbmir `public.*`) | Target (ehow `app_data.*`) | Key mapping |
|---|---|---|
| `teams {id bigint, org_id, name, color}` | `teams {id uuid, tenant_id, nspbmir_id bigint, name, color}` | `id → nspbmir_id`; deterministic uuid for `id` |
| `team_members {team_id bigint, person_id bigint, org_id}` | `team_members {id uuid, team_id uuid, staff_id uuid, tenant_id}` | `person_id → staff_id` via bridge; `team_id → teams.id` |
| `leave_requests {requester_name, leave_type, date_start, date_end, note, approver_name, individual_days, status, archived, ...}` | `leave_requests {leave_request_id uuid, tenant_id, staff_id, leave_type, from_date, to_date, status, reason, approver_id, archived, imported_from, ...}` | `requester_name → staff_id`; `date_start → from_date`; `note → reason`; `approver_name → approver_id` |

## Identity bridge (pre-built, 49/49)

`nspbmir public.people.canonical_id == ehow app_data.staff.staff_id`; ehow
`staff.external_id` also mirrors the legacy person id. The resolver
(`identity-bridge.ts`) is injected into the transforms:

- `byExternalId(person_id)` — exact (team_members reference people by id).
- `byName(full_name)` — fallback for leave (source is name-keyed). Case- and
  whitespace-insensitive. **Ambiguous names resolve to `null` and are reported,
  never guessed.**

## Lossy / needs-decision: `individual_days`

nspbmir `leave_requests.individual_days` (jsonb) lists **non-contiguous** days a
request covers. The normalized target has **only** a `from_date..to_date` span —
no column for non-contiguous days. The transform **keeps the span** (min..max of
the listed days), **flags** the row `lossy_individual_days` / `needsDecision`,
and **never silently drops it**. These rows are listed in the dry-run report for
a human call before any apply.

## Scope filter

SKS org only: `org_id = '1eb831f9-aeae-4e57-b49e-9681e8f51e15'`. The demo org
`2ec74247-43cd-4529-ac3e-d6c5aa4f9e2d` is **excluded**.

## Run the dry-run

```bash
# READ-ONLY service keys — the script never writes in dry-run.
export NSPBMIR_SUPABASE_URL=...           # source (nspbmirochztcjijmcrx)
export NSPBMIR_SUPABASE_SERVICE_KEY=...
export EHOW_SUPABASE_URL=...              # target (ehowgjardagevnrluult)
export EHOW_SUPABASE_SERVICE_KEY=...
export EHOW_TENANT_ID=7dee117c-98bd-4d39-af8c-2c81d02a1e85   # optional; defaults to this

node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs            # both surfaces
node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --surface=leave
node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --json     # machine-readable
```

The report covers: source row counts (SKS-only), bridge staff count + ambiguous
names, would-be-insert counts, unmatched identities, orphan-team members,
duplicate member pairs, and the leave needs-decision (`individual_days`) list.

## Reconcile view

`migration-reconcile.ts` + the **Admin → Migration** page pick up the new tables
automatically: `eq_migration_counts` dynamically counts every `app_data` table
with a `tenant_id` column, so once `teams` / `team_members` / `leave_requests`
exist they appear as "landed" rows. `leave_requests` already drills into the
`/data/leave_request` browser; `teams` / `team_members` show counts without a
drill-in link (not in the browse RPC's allow-list — consistent with other
non-browsable tables).

## Needs Royce (blockers for apply)

1. **Live service keys** for nspbmir + ehow (read-only is enough for the
   dry-run).
2. **Target tables**: ehow `app_data.teams` / `team_members` don't exist yet —
   they need a governed DDL migration through the One Pipe (`tenant-migrations`)
   before any apply. `leave_requests` already exists.
3. **Decision** on the `needs_decision` leave rows (non-contiguous
   `individual_days`) surfaced by the dry-run.
4. **Wire + run `--apply`** — intentionally not implemented on this branch.
```
