# Data Quality Checks — Catalog

Every invariant enforced by `audits/run.sql`, with the reason it exists. When a check fires, find it here first before debugging the data.

**Framework:** DAMA-DMBOK data quality dimensions (completeness, uniqueness, validity, consistency) plus Postgres/Supabase structural invariants.

**Levels:**
- `ERROR` — must be zero before a release. A release with any ERROR failure is blocked.
- `WARN` — allowed to be non-zero with a documented reason in `audits/baseline-*.md`.

To add a new check: add it to `run.sql`, document it here with the *why*, re-baseline.

---

## Completeness — required fields not null

Required for a row to be usable. A null in one of these fields means the record is broken and needs fixing before anything depends on it.

| Check | Level | Why |
|---|---|---|
| `completeness.assets.site_id` | ERROR | Every active asset must live on a site. Assets with null `site_id` are orphaned and don't appear in grouped views or site reports. |
| `completeness.assets.tenant_id` | ERROR | RLS depends on `tenant_id`. A null here is a security hole — the row becomes invisible to every tenant's policy. |
| `completeness.assets.job_plan_id` | WARN | Assets need a job plan to schedule maintenance against. Nulls are allowed temporarily during import/backfill but must be resolved before the asset is scheduled. Current known-null count is documented in the baseline. |
| `completeness.sites.customer_id` | ERROR | Every site belongs to a customer. A null here breaks customer reports and billing. |
| `completeness.sites.code` | ERROR | Code is the short identifier used everywhere in the UI (SY1, SYD11, STG). Nulls are never valid. |
| `completeness.sites.city` | ERROR | Required for reports, O&M manuals, dispatch. Forced by migration 0041. |
| `completeness.sites.postcode` | ERROR | Same as city — required for reports and dispatch. |
| `completeness.sites.state` | ERROR | Required for jurisdiction-aware reporting (standards and regulations differ across states). |
| `completeness.customers.name` | ERROR | Customer name is the primary display field across the app. Nulls and empty strings are both caught. |
| `completeness.defects.asset_id` | ERROR | A defect without an asset is not actionable. Hard requirement of the defects workflow. |
| `completeness.maintenance_checks.site_id` | ERROR | Maintenance checks are scheduled by site. A null here means the check has nowhere to run. |
| `completeness.pm_calendar.site_id` | ERROR | PM calendar entries drive scheduling. Nulls orphan the entry. |

---

## Uniqueness — no duplicates on natural keys

Duplicates corrupt counts, break imports, and confuse users who can't tell which record is "the real one".

| Check | Level | Why |
|---|---|---|
| `uniqueness.customers.tenant_name` | ERROR | Within a tenant, customer names must be unique (case-insensitive, whitespace-trimmed). Duplicates cause ambiguous customer dropdowns and double-counting in billing. Triggered the 2026-04-15 consolidation when `Equinix Australia` and `Equinix Australia Pty Ltd` coexisted. |
| `uniqueness.sites.tenant_code` | ERROR | Site codes like `SY1` must be unique within a tenant. Duplicates break the Sites page and asset imports. |
| `uniqueness.sites.tenant_name` | ERROR | Site names must be unique within a tenant for the same reason as codes. |
| `uniqueness.assets.site_serial` | WARN | Assets with the same serial number on the same site are almost always a data-entry mistake. WARN rather than ERROR because legitimate shared serials (multi-card units) do occur. |

---

## Validity — values inside the allowed domain

The database will accept any string in these fields — we enforce the shape at the audit layer until we can add CHECK constraints.

| Check | Level | Why |
|---|---|---|
| `validity.sites.postcode_format` | ERROR | Australian postcodes are exactly four digits. Catches typos, trailing spaces, and foreign-format imports. |
| `validity.sites.state_au` | ERROR | State must be one of `NSW, VIC, QLD, WA, SA, TAS, NT, ACT`. Catches full-name entries (`New South Wales`) and typos. |
| `validity.timestamps.assets` | ERROR | `updated_at < created_at` is physically impossible. A failure here points at a buggy trigger or a backdated import. |
| `validity.timestamps.sites` | ERROR | Same as assets. |
| `validity.timestamps.customers` | ERROR | Same as assets. |

---

## Consistency — cross-table agreement

The same fact can appear in multiple tables (e.g. an asset's site is stored on `assets.site_id` but also on `acb_tests.site_id` for query speed). When these disagree, one of them is wrong and a user somewhere is seeing stale data.

| Check | Level | Why |
|---|---|---|
| `consistency.assets.site_active` | ERROR | An active asset must be attached to an active site. The 2026-04-15 SY1/SY4 bug was exactly this — 488 assets orphaned on archived parent sites. |
| `consistency.sites.customer_active` | ERROR | An active site must belong to an active customer. Same class of bug as above. |
| `consistency.assets.site_tenant_match` | ERROR | `asset.tenant_id` must equal its site's `tenant_id`. A mismatch is an RLS hole — the asset could be visible to the wrong tenant. |
| `consistency.sites.customer_tenant_match` | ERROR | `site.tenant_id` must equal its customer's `tenant_id`. Same reason. |
| `consistency.acb_tests.site_matches_asset` | ERROR | `acb_tests.site_id` must match the current `assets.site_id`. When an asset moves between sites, all its test rows must follow. Catches migrations that forgot to update denormalised site columns. |
| `consistency.nsx_tests.site_matches_asset` | ERROR | Same as acb_tests. |
| `consistency.test_records.site_matches_asset` | ERROR | Same as acb_tests. |
| `consistency.defects.site_matches_asset` | ERROR | Same as acb_tests. |
| `consistency.acb_tests.tenant_matches_asset` | ERROR | Denormalised `tenant_id` on tests must match the asset's `tenant_id` — an RLS safety check. |

---

## Structural — Postgres / Supabase invariants

These are properties of the schema itself, not the data. A failure here means someone added a table without following the conventions in `AGENTS.md`.

| Check | Level | Why |
|---|---|---|
| `structural.rls_enabled` | ERROR | Every `public` table must have row-level security enabled. `AGENTS.md` mandates it. Catches new tables that shipped without RLS. |
| `structural.primary_key` | ERROR | Every `public` table must have a primary key. Required for Supabase realtime, for `onRowClick` navigation, and for safe deletes. |
| `structural.fk_covering_index` | WARN | Every foreign key should have a covering index. Migration 0042 fixed the whole schema once. WARN rather than ERROR because new FKs may be added in a migration that only adds the index in the *next* migration. If this fires, the next migration must include the covering index. |

---

## Scaling — table sizes that should trigger action

Future-perf canaries. These don't measure data quality; they fire when the **shape of the data** crosses a threshold where the architecture should change. Action when a check here fails is "design + ship a migration to handle the new scale", not "fix a row."

| Check | Level | Why |
|---|---|---|
| `scaling.audit_logs.size` | WARN | `audit_logs` is unbounded and unpartitioned. The 2026-05-15 perf review flagged this as a 5-year concern at 10x scale (~625k rows). 500k is the trigger point — 6-12 months of headroom to design + ship monthly partitioning + retention (drop partitions > 24 months) before query performance starts to degrade. When this fires, the partitioning conversation reopens with concrete numbers, not projections. |
| `scaling.maintenance_check_items.size` | WARN | The `.limit(10000)` pattern appears 23 times across the app (analytics, reports, compliance-report, maintenance pages). `maintenance_check_items` is the closest to the cap (5193 rows currently, accessed per-check so per-query volume is fine). At ~50k total rows the `.in('check_id', checkIds).limit(10000)` calls on /maintenance list start risking silent truncation. Refactor target: server-side aggregation via RPC (same pattern as `get_dashboard_counts`). |
| `scaling.check_assets.size` | WARN | 619 rows currently. Same `.limit(10000)` consideration as above — fires before silent truncation. |
| `scaling.maintenance_checks.size` | WARN | 33 active rows currently. /analytics and /reports pull all active checks for monthly aggregation; at 50k+ the `.limit(10000)` truncates. Refactor target: month-bucketed RPC instead of pulling rows. |
| `scaling.acb_tests.size` | WARN | 149 rows currently. Same pattern as maintenance_checks above. |
| `scaling.nsx_tests.size` | WARN | 94 rows currently. Same pattern. |
| `scaling.test_records.size` | WARN | 13 rows currently. Same pattern. |

---

## Freshness / timeliness — DAMA timeliness dimension

A valid record can still be stale. These checks surface records that haven't moved in a long time so nobody silently accumulates debt. All WARN-level — a stale record is a smell, not a block. Thresholds are deliberately generous to avoid nagging on edge cases and should be tightened as volume grows.

| Check | Level | Why |
|---|---|---|
| `freshness.defects.open_over_90_days` | WARN | A defect raised against an asset that sits in `status='open'` for 90 days is either being ignored or is waiting on someone. Either way it should be visible. 90 days is the quarterly compliance cycle — if it's still open at 90 days it's by definition overdue against a quarterly PM cadence. |
| `freshness.acb_tests.in_progress_over_30_days` | WARN | An ACB test that was started but never completed is a report-integrity risk — it will sit at partial status and drag down the `/reports` compliance dashboard. 30 days is long enough to cover a normal site visit, short enough to catch actual abandonment. |
| `freshness.nsx_tests.in_progress_over_30_days` | WARN | Same reasoning as ACB — applies now that NSX Steps 2 & 3 are no longer placeholders and a partial NSX test represents real technician work in flight. |

**Not yet added (on the backlog):**

- `freshness.pm_calendar.overdue` and `freshness.maintenance_checks.overdue_due_date` — waiting to confirm the `next_due_date` / `due_date` column naming on those tables before I wire them in. No point shipping a check against the wrong column name.
- `freshness.general_tests.in_progress_over_30_days` — requires locating the `general_tests` / `test_records` table and confirming it has equivalent workflow status columns. Not done in this session.

---

## Not currently checked (known gaps)

Things we'd add if we had more time or the data to check against:

- **Accuracy** — reconciliation against an external source of truth (e.g. the Delta Elcom master file). Done manually on 2026-04-16; not automated because we only have one snapshot and the master file isn't a live feed.
- **Timeliness** — freshness thresholds on PM calendar / maintenance checks / test records. Needs Royce to define "stale" per table.
- **Supabase advisor findings** — currently run manually via `get_advisors`. Could be folded into `run.sql` via the advisor RPC, pending a cleaner API for it.
- **ACB/NSX field-level validity** — `performance_level in (N1,H1,H2,H3,L1)`, pole count reasonableness, IN rating ranges. Needs confirmation on which fields are required vs. optional.
- **Attachment orphans** — attachments pointing at deleted parent rows. Not yet a problem but will become one as the attachments table grows.
- **Audit log coverage** — every row mutation in the tables above should produce a matching `audit_logs` entry. Hard to check without sampling; deferred.

---

## How to run

```sql
-- Against any environment with psql or the Supabase SQL editor:
\i audits/run.sql
```

Or via the Supabase MCP:
```
execute_sql(project_id='urjhmkhbgaxrofurpbgc', query=<contents of audits/run.sql>)
```

Expected output: one row per check, failures first, ERRORs before WARNs. A clean run has zero ERROR failures. WARN failures must be accounted for in the current `audits/baseline-*.md`.

---

## CI behaviour

`audits/run.sql` is executed automatically by `.github/workflows/data-quality.yml` on:

- Every PR that touches `audits/**`, `supabase/migrations/**`, or the workflow file itself.
- Every push to `main`.
- Daily at 08:30 UTC (~18:30 AEST).
- Manual dispatch from the Actions tab.

The workflow hits the Supabase Management API (`POST /v1/projects/{ref}/database/query`) using a read-only `SUPABASE_ACCESS_TOKEN` secret and executes the script in a single statement. No writes are performed at any point.

**Failure rules:**

- **ERROR checks with `fail_count > 0`** fail the build. This is non-negotiable — if a PR introduces an ERROR failure it cannot be merged until the underlying data is fixed or the check is consciously relaxed.
- **WARN checks with `fail_count > 0`** are tabulated in the job summary and uploaded as an artifact (`audit.json`) but do **not** fail the build. WARN counts should be tracked against `audits/baseline-*.md`.

**Waiving an ERROR check:**

Do not add ad-hoc skips in the workflow. If a specific row needs a temporary carve-out, either (a) fix the data, (b) lower the check to WARN in `run.sql` with a comment explaining why and a linked follow-up, or (c) add a new, tighter check that excludes the known exception. All three options land in a PR that's reviewed by Royce.

**Re-baselining after intentional churn:**

When a migration deliberately changes expected counts (e.g. reconciling a customer split), regenerate `audits/baseline-YYYY-MM-DD.md` in the same PR as the migration so the WARN deltas have a paper trail.
