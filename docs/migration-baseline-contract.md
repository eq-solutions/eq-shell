# Migration baseline contract

For any console/script migrating a tenant's data into an EQ canonical
(`app_data`) tenant database. One line in your migration makes the data show up,
verified, in Shell's **Admin → Migration** reconciliation view
(`core.eq.solutions/<tenant>/admin/migration`).

## What you do

As you migrate each entity, record how many rows you **expected** to load — the
count from the legacy source — into `app_data.migration_baseline`, **in the same
transaction as the load**. That's it. Shell does the rest (counts what actually
landed, diffs it, scans for broken foreign-key links).

## The contract

```sql
-- Run inside the same transaction that loads <entity> for this tenant.
INSERT INTO app_data.migration_baseline (tenant_id, entity, expected_count, source_note)
VALUES (
  '<tenant-uuid>',     -- the tenant's id (same tenant_id you stamp on the rows)
  'staff',             -- the app_data TABLE NAME (plural), e.g. 'staff','customers','licences'
  1234,                -- rows you expected to load (legacy source count)
  'sks-nsw-labour staff, wave 1'   -- free text: where the number came from
)
ON CONFLICT (tenant_id, entity) DO UPDATE
  SET expected_count = EXCLUDED.expected_count,
      source_note    = EXCLUDED.source_note,
      updated_at     = now();
```

### Rules

- **`entity` is the `app_data` table name**, plural — `staff`, `customers`,
  `contacts`, `sites`, `licences`, `assets`, `schedule_entries`, … — *not* the
  singular canonical entity name. (It's the key Shell counts landed rows under.)
- **Same transaction as the load.** If the load rolls back, the baseline rolls
  back with it — no baseline ever claims a load that didn't happen.
- **Idempotent.** The `ON CONFLICT` upsert means re-running a wave just updates
  the number. Safe to run every time.
- **One row per entity per tenant.** Migrating in waves? Set `expected_count` to
  the cumulative expected total each time, not the wave delta.
- **`expected_count` is the SOURCE count**, before any de-dup/transform you do —
  so the view shows you if your transform dropped rows.

## What you get, per entity, in the view

| Column | Meaning |
|---|---|
| Expected | what you recorded above |
| Landed | rows actually in `app_data.<entity>` for this tenant |
| Difference | landed − expected (non-zero = something didn't land, or duplicated) |
| Broken links | rows that landed but point at a parent that didn't (e.g. a licence whose staff is missing) |
| Rejected | rows the Intake pipe rejected, if you loaded via Intake (0 for direct loads) |

A row is **Reconciled** only when a baseline is set, the difference is 0, nothing
was rejected, and there are no broken links.

## Notes

- No baseline for an entity → it still shows landed counts and broken-link
  scans, just marked "No baseline" (can't be judged complete).
- **Broken links** come from a scan of every enforced foreign key in `app_data`.
  If you bulk-load with FK triggers disabled
  (`SET session_replication_role = 'replica'`), this is what catches the orphans
  that slipped past the constraints — re-enable and check the view before cutover.
- Requires tenant migrations `0037_migration_baseline` and
  `0038_migration_orphans_rpc` applied to the target tenant DB.
