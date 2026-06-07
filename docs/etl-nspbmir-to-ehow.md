# nspbmir → ehow ETL (full operational dataset) — dry-run + gated apply

Cross-DB **data** movement from the SKS standalone Field database (nspbmir,
`nspbmirochztcjijmcrx`, wide `public.*`) into the SKS canonical data plane (ehow,
`ehowgjardagevnrluult`, normalized `app_data.*`). Four surfaces: **teams**,
**leave**, **timesheets**, **schedule**.

> This is **data** movement, **not** a tenant DDL migration. It does **not** go
> through `tenant-migrate.yml` / `supabase/tenant-migrations`. It mirrors the
> existing one-off sync scripts (`sync-tenant-data.mjs`,
> `sync-field-to-canonical.mjs`).

The transforms **mirror the settled eq-solves-field canonical adapters** so a
`wide → ETL → ehow → adapter → wide` round-trip is consistent:

| Surface | Authoritative adapter (eq-solves-field) | Transform |
|---|---|---|
| leave | `scripts/leave-adapter.js` | `transform-leave.ts` |
| timesheets | `scripts/timesheets-adapter.js` | `transform-timesheets.ts` |
| schedule | `scripts/roster-adapter.js` | `transform-schedule.ts` |
| teams | (no adapter — provenance map) | `transform-teams.ts` |

## Status: dry-run by default; apply is double-gated and OFF here

The runner **defaults to dry-run** and **writes nothing** unless BOTH gates pass:

1. the explicit `--apply` flag, **and**
2. real service-role keys for both planes
   (`NSPBMIR_SERVICE_KEY`/`NSPBMIR_URL` + `EHOW_SERVICE_KEY`/`EHOW_URL` — the
   `*_SUPABASE_*` spellings are also accepted).

It **never writes in CI** (`process.env.CI`). **This PR ships no keys, so apply
cannot run** — the runner falls back to a read-only report. Reads of nspbmir are
read-only; writes (apply only) target **ehow exclusively** — a separate DB the
live SKS standalone never reads.

## Per-table enum mapping (LIVE-verified — they DIFFER)

### leave → `app_data.leave_requests`
- status: lowercased onto `{pending, approved, rejected, cancelled}`;
  `Withdrawn → cancelled`.
- leave_type onto `{annual, sick, personal, long_service, unpaid, tafe, other}`
  (**no `rdo`**): `A/L → annual`, `U/L → unpaid`.
- **RDO → `other` + lossless carrier** `[leave_type: RDO]` prefixed onto `reason`
  (this table has no `rdo` enum). Flagged `rdo_folded_to_other` + needs-decision.
- CHECK `to_date >= from_date` enforced — a reversed span is **blocked**
  (`to_date_before_from_date`), never emitted.
- non-contiguous `individual_days` → span kept (min..max) + `lossy_individual_days`.

### timesheets → `app_data.timesheets`
- wide one-row-per-week explodes to one row per **day per job segment**.
- status from `approved` bool: `true → approved`, else `submitted` (`draft`
  reachable only via an explicit draft flag nspbmir doesn't have).
- shift left `null`; `hours >= 0`; `<day>_job` label kept in `task`;
  **`site_id` null** (no resolver) → `site_id_unresolved` warning.

### schedule → `app_data.schedule_entries`
- wide cell grammar → one row per **day**. status `{planned, …, cancelled, …}`;
  leave_type `{annual, sick, personal, **rdo**, tafe, unpaid, public_holiday, other}`.
- **RDO cell → `leave_type='rdo'`** (this table HAS `rdo` — the per-table split).
- `OFF → status='cancelled' + task='OFF'`; blank cell → no row; education before
  leave; site code → `planned` + verbatim `task`; `<day>_job` pin → `notes "job:<n>"`.
- **excludes `pending_schedule`** (Tender-Pipeline labour-curve table).

## RDO is the #1 mistake source — same word, different target

| Source row | Target table | leave_type | Carrier |
|---|---|---|---|
| roster cell `RDO` | `schedule_entries` | `rdo` (valid) | `task='RDO'` |
| leave request type `RDO` | `leave_requests` | `other` | `[leave_type: RDO]` in `reason` |

## Idempotency

Every target row's PK is a **deterministic uuid** (sha256-namespaced on
tenant + natural key): leave `leave_request(tenant, src.id)`; timesheet
`timesheet(tenant, staff, date, segIdx)`; schedule `schedule_entry(tenant, staff,
date)`; teams/members on tenant + legacy id. Dry-run and apply compute the same
PK, and `--apply` does an `UPSERT onConflict=<pk>` — re-runs overwrite, never
duplicate.

## Identity bridge (pre-built, 49/49)

`nspbmir public.people.canonical_id == ehow app_data.staff.staff_id`; ehow
`staff.external_id` mirrors the legacy person id. Resolver
(`identity-bridge.ts`): `byExternalId(person_id)` (teams) and `byName(full_name)`
(leave/timesheets/schedule — source is name-keyed). **Ambiguous names resolve to
`null` and are reported, never guessed.**

## Scope filter

SKS org only: `org_id = '1eb831f9-aeae-4e57-b49e-9681e8f51e15'`. Demo org
`2ec74247-43cd-4529-ac3e-d6c5aa4f9e2d` **excluded**.

## Run

```bash
export NSPBMIR_URL=...           # source (nspbmirochztcjijmcrx)
export NSPBMIR_SERVICE_KEY=...   # read-only
export EHOW_URL=...              # target (ehowgjardagevnrluult)
export EHOW_SERVICE_KEY=...
export EHOW_TENANT_ID=7dee117c-98bd-4d39-af8c-2c81d02a1e85   # optional; default

node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs                  # dry-run, all surfaces
node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --surface=schedule
node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --json
node --import tsx/esm scripts/etl-nspbmir-to-ehow.mjs --apply          # WRITE — needs all 4 keys, refused in CI
```

The report prints a per-table summary: read, resolved, blocked, would-upsert /
upserted, plus unmatched identities and each surface's needs-decision lists.

## Standing decisions for Royce (blockers for apply)

1. **RDO-in-leave schema gap.** `leave_requests` has no `rdo` enum value, so a
   leave request of type RDO folds to `other` (+ lossless `[leave_type: RDO]`
   carrier). **Decide: add `'rdo'` to the `leave_requests.leave_type` enum (clean
   round-trip) vs keep `other` + carrier.** `schedule_entries` already has `rdo`.
2. **`schedule_entries.site_id` is `NOT NULL` live** but the roster surface has no
   site_id resolver — the ETL emits `site_id=null` + `hours_planned=0`, flagged
   `site_id_required_not_null`. A real apply would be rejected by the constraint.
   **Decide: wire a label→site_id resolver, or relax the constraint, before
   applying the schedule surface.** (Teams/leave/timesheets are not affected.)
3. **Live service keys** for nspbmir + ehow.
4. **Target tables** `app_data.teams` / `team_members` must exist (governed DDL
   migration through the One Pipe) before applying the teams surface;
   `leave_requests`, `timesheets`, `schedule_entries` already exist.
```
