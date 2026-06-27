-- 0145_gm_invoice_run_status_extend.sql
-- Extend gm_invoice_run.status to distinguish progress claims from final invoices.
--
-- New values:
--   invoiced_progress — progress claim sent, job continues
--   invoiced_complete — final invoice, job done
--
-- Legacy 'invoiced' value is retained so existing rows continue to display.

ALTER TABLE app_data.gm_invoice_run
  DROP CONSTRAINT gm_invoice_run_status_check,
  ADD CONSTRAINT gm_invoice_run_status_check
    CHECK (status IN ('invoiced', 'invoiced_complete', 'invoiced_progress', 'story'));
