-- Migration 0055: report_deliveries cascades when the underlying maintenance_check is deleted
--
-- Context: bulk-delete on /maintenance was failing with
--   "update or delete on table maintenance_checks violates foreign key constraint
--    report_deliveries_maintenance_check_id_fkey on table report_deliveries"
-- because the FK was the default NO ACTION (RESTRICT).
--
-- report_deliveries is a thin audit row (who/when a PDF was emailed). When a
-- maintenance check is deleted (typically because it was created in error), the
-- delivery record is useless on its own — you can't tell which check it was
-- about. CASCADE matches the behaviour of maintenance_check_items and
-- check_assets, which both cascade.
--
-- audit_logs keeps a separate paper trail of the delete operation itself.

alter table public.report_deliveries
  drop constraint if exists report_deliveries_maintenance_check_id_fkey;

alter table public.report_deliveries
  add constraint report_deliveries_maintenance_check_id_fkey
  foreign key (maintenance_check_id)
  references public.maintenance_checks(id)
  on delete cascade;
