-- 0098: composite index on maintenance_checks for the dashboard counts
-- and the cron overdue scan.
--
-- Two hot query shapes today both rely on (tenant_id, status, due_date)
-- predicates with no single index that covers all three columns:
--
--   1. Cron overdue scan (app/api/cron/dispatch-notifications/route.ts):
--        WHERE status = 'scheduled' AND due_date < now() AND is_active = true
--      Runs every 15 minutes per pg_cron schedule. Currently relies on
--      idx_maintenance_checks_status (or a sequential scan), so each tick
--      grows linearly with table size.
--
--   2. Dashboard counts (app/(app)/dashboard/page.tsx):
--        WHERE tenant_id = $1 AND status = $2 AND due_date BETWEEN ...
--      Hit on every dashboard render — supervisor / admin landing page.
--
-- The partial WHERE is_active = true matches every real query pattern
-- (soft-deleted rows are never shown to users) and keeps the index small
-- by excluding archived rows. Estimated win: shaves the cron tick from
-- O(table_size) to O(matching_rows) and removes the bitmap merge from
-- the dashboard count plan.
--
-- Index is created non-concurrently because Supabase migrations run in
-- a transaction. maintenance_checks is small enough today that the
-- brief ACCESS EXCLUSIVE lock is acceptable; revisit if the table grows
-- past a million rows.

CREATE INDEX IF NOT EXISTS idx_maintenance_checks_tenant_status_due
  ON public.maintenance_checks (tenant_id, status, due_date)
  WHERE is_active = true;

COMMENT ON INDEX public.idx_maintenance_checks_tenant_status_due IS
  'Covers the cron overdue scan and dashboard status counts. Partial: is_active=true. Added 2026-05-15 from the perf review.';
