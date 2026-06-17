-- Migration: 0135_quote_status_invoiced
-- Target:    Every tenant data-plane (ehow + zaap)
-- Purpose:   Add 'invoiced' to the quote_status_check and quote_status_history
--            constraints. 'invoiced' was added to the frontend taxonomy
--            (taxonomy.ts, NEXT_STATUSES) but the DB constraint never widened,
--            causing EQ-SHELL-5 (23514 check violation) when a user advanced
--            a quote to Invoiced from Complete or Ready to Invoice.
--
-- All idempotent: DROP IF EXISTS + ADD.

ALTER TABLE app_data.quote DROP CONSTRAINT IF EXISTS quote_status_check;
ALTER TABLE app_data.quote ADD CONSTRAINT quote_status_check
  CHECK (status = ANY (ARRAY[
    'draft','submitted','client-reviewing','verbal-win','won-awaiting-job-no',
    'won-job-created','po-matched','active','complete','ready-to-invoice',
    'invoiced','on-hold','lost','cancelled','expired','superseded'
  ]));

ALTER TABLE app_data.quote_status_history DROP CONSTRAINT IF EXISTS qsh_to_status_check;
ALTER TABLE app_data.quote_status_history ADD CONSTRAINT qsh_to_status_check
  CHECK (to_status = ANY (ARRAY[
    'draft','submitted','client-reviewing','verbal-win','won-awaiting-job-no',
    'won-job-created','po-matched','active','complete','ready-to-invoice',
    'invoiced','on-hold','lost','cancelled','expired','superseded'
  ]));

ALTER TABLE app_data.quote_status_history DROP CONSTRAINT IF EXISTS qsh_from_status_check;
ALTER TABLE app_data.quote_status_history ADD CONSTRAINT qsh_from_status_check
  CHECK (from_status IS NULL OR from_status = ANY (ARRAY[
    'draft','submitted','client-reviewing','verbal-win','won-awaiting-job-no',
    'won-job-created','po-matched','active','complete','ready-to-invoice',
    'invoiced','on-hold','lost','cancelled','expired','superseded'
  ]));
