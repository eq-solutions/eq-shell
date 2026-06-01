---
title: Tenant Migration Ledger
last_updated: 2026-06-01
scope: Applied-status of every supabase/tenant-migrations/*.sql file across all live tenants
---

# Tenant Migration Ledger

Tracks applied state of every file in `supabase/tenant-migrations/`, which `scripts/migrate-tenants.mjs` applies to each tenant data plane in filename-sorted order.

The runner tracks by **full filename** (e.g. `0017_assets_cert_url.sql`). Older rows recorded by the pre-2026-05-30 runner used the basename without extension (e.g. `0017_assets_cert_url`).

## Applied state (queried 2026-06-01)

| File | Purpose | ehowg (SKS · `ehow…uult`) | zaap (EQ · `zaap…chl`) |
|------|---------|--------------------------|------------------------|
| `0001_baseline.sql` | Core `app_data` schema — entities, contacts, sites, people | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0002_remaining_tables.sql` | Remaining core tables (assets, timesheets, etc.) | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0003_dashboard_rpcs.sql` | Dashboard RPC functions | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0004_browse_entity_rpc.sql` | `eq_browse_entity` RPC | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0005_intake_cards_rpc.sql` | Cards intake RPC | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0006_cards_rpcs.sql` | Cards RPCs | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0007_cards_profile_rpc.sql` | Cards profile RPC | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0008_intake_service_rpc.sql` | Service intake RPC | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0009_intake_quotes_rpc.sql` | Quotes intake RPC | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0010_intake_core_rpc.sql` | Core intake RPC | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0011_intake_field_rpc.sql` | Field intake RPC | ✅ 2026-05-24 | ✅ 2026-05-24 |
| `0012_dashboard_counts_v2.sql` | Dashboard count improvements | ✅ 2026-05-28 | ⚪ not applied |
| `0013_write_canonical_event_rpc.sql` | Write-canonical-event RPC | ✅ 2026-05-28 | ⚪ not applied |
| `0014_browse_entity_search.sql` | Full-text search on entity browser | ✅ 2026-05-28 | ✅ 2026-05-28 |
| `0015_missing_tenant_indices.sql` | Performance indices on tenant tables | ✅ 2026-05-28 | ✅ 2026-05-28 |
| `0016_browse_entity_active_filter.sql` | Active/inactive filter on entity browser | ✅ 2026-05-28 | ✅ 2026-05-28 |
| `0017_assets_cert_url.sql` | `cert_url` column on `assets` (calibration / compliance cert link) | ✅ 2026-05-29 | ✅ 2026-05-29 |
| `0018_dashboard_counts_asset.sql` | Asset count tile on dashboard | ⚪ not applied | ✅ 2026-05-29 |
| `0019_dashboard_asset_service_due.sql` | Service-due asset card on dashboard | ⚪ not applied | ✅ 2026-05-29 |
| `0020_service_cmms.sql` | CMMS core schema (work orders, maintenance records) | ⚪ not applied | ✅ 2026-05-30 |
| `0021_service_ppm_rpcs.sql` | PPM (Planned Preventive Maintenance) RPCs | ✅ 2026-05-30 | ✅ 2026-05-30 |
| `0022_canonical_write_rpcs.sql` | Canonical write RPCs | ⚪ not applied | ✅ 2026-05-30 |
| `0023_intake_infra.sql` | Intake infrastructure tables | ✅ 2026-05-30 | ⚪ not applied |
| `0024_gm_reports.sql` | GM Reports — `gm_report_periods` + `gm_job_rows` (idempotent) | ⚠️ tables exist (out-of-band); apply via runner to register | ⚪ not applied |
| `0025_briefing.sql` | AI briefing — `briefing_cache` + `briefing_actions` with `tenant_id NOT NULL` | ⚠️ tables exist (out-of-band + reshaped 2026-06-01); apply via runner to register | ⚪ not applied |
| `0026_briefing_cache_and_actions.sql` | Same tables, older nullable shape + `ADD COLUMN IF NOT EXISTS tenant_id` safety net | ⚪ will be no-op after 0025 | ⚪ will be no-op after 0025 |
| `0027_drop_intake_vestiges.sql` | Drop orphaned `eq_intake_*` tables | ⚠️ tables already dropped (2026-06-01 direct SQL); runner apply will no-op | ⚪ not applied |
| `0028_contact_customer_links.sql` | Contact ↔ customer links table | ⚪ not applied | ⚪ not applied |

## Out-of-band migrations (direct SQL, not runner-tracked)

Applied via Supabase MCP — no entry in `_eq_migrations`, but DB state reflects the change.

| Tenant | Name | Applied | Purpose |
|--------|------|---------|---------|
| ehowg (SKS) | `sks_gm_briefing_reshape_expand` | 2026-06-01 | ADD `tenant_id` (nullable) + backfill on `gm_report_periods`, `briefing_cache`, `briefing_actions` |
| ehowg (SKS) | `sks_gm_briefing_reshape_contract` | 2026-06-01 | Promote `tenant_id` to NOT NULL; drop old unique, add `(tenant_id, period_code)` unique |
| ehowg (SKS) | `drop_intake_vestige_tables` | 2026-06-01 | Dropped `eq_intake_submissions`, `eq_intake_field_assignments`, `eq_intake_field_values`, `eq_intake_attachments` |
| ehowg (SKS) | `030_secdef_caller_tenant_guard` | 2026-05-31 | `search_path` pin on 8 RPCs; tenant self-gate on 4 `sks_quotes_*` RPCs (SECDEF) |
| ehowg (SKS) | `sks-canonical` migration series (`013_*` – `023_*`) | 2026-05-25–26 | Old sks-canonical runner migrations; stored in same `_eq_migrations` table but different numbering convention |

## Pending catch-up (ehowg SKS)

Missing in `_eq_migrations` but SQL is idempotent — safe to apply via the runner:
`0018`, `0019`, `0020`, `0022`, `0024`, `0025`, `0026`, `0027`, `0028`

Run: `node scripts/migrate-tenants.mjs --slug=sks --dry-run` to preview first.

## Pending catch-up (zaap EQ)

Missing in `_eq_migrations`:
`0012`, `0013`, `0023`, `0024`, `0025`, `0026`, `0027`, `0028`

Run: `node scripts/migrate-tenants.mjs --slug=core --dry-run` to preview first.

## Notes

- The migration runner (post-2026-05-30 rewrite) tracks by full filename with `.sql` extension; the old runner embedded `INSERT INTO _eq_migrations` inside the SQL using the basename without extension. Both are in the table — the runner handles the key mismatch gracefully (re-applies with new key, idempotent SQL).
- `0026` was previously named `0017_briefing_cache_and_actions.sql` (duplicate prefix, wrong slot). Renamed in PR #121.
