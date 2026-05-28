-- Migration: 0015_missing_tenant_indices
-- Target:    Per-tenant data plane
-- Purpose:   Add tenant_id indices to tables that were created without one.
--            All entity-browser and EQ app queries filter by tenant_id;
--            missing indices mean full-table scans on shared tables.
--
--            Tables already covered (not repeated here):
--              assets, canonical_events, contacts, customers, incidents,
--              itp_records, jobs, jsa_records, leave_balances, licences,
--              prestart_checks, quote*, rate_library, schedule_entries,
--              scope_template, site_diaries, sites, staff, swms,
--              tenant_app_configs, tenders, timesheets, toolbox_talks
--
--            Covered in this migration:
--              apprentice_profiles, buddy_checkins, checkins,
--              engagement_logs, feedback_entries, leave_approval_logs,
--              leave_requests, quarterly_reviews, quote_attachment,
--              quote_line_item, quote_status_history, rotations,
--              schedule_change_logs, skills_ratings, tafe_calendars,
--              tender_enrichments, tender_import_runs, tender_nominations,
--              tender_review_decisions, weekly_reports
--
--            Each index is created IF NOT EXISTS so the migration is safe
--            to re-run.

CREATE INDEX IF NOT EXISTS apprentice_profiles_tenant_idx
  ON app_data.apprentice_profiles (tenant_id);

CREATE INDEX IF NOT EXISTS buddy_checkins_tenant_idx
  ON app_data.buddy_checkins (tenant_id);

CREATE INDEX IF NOT EXISTS checkins_tenant_idx
  ON app_data.checkins (tenant_id);

CREATE INDEX IF NOT EXISTS engagement_logs_tenant_idx
  ON app_data.engagement_logs (tenant_id);

CREATE INDEX IF NOT EXISTS feedback_entries_tenant_idx
  ON app_data.feedback_entries (tenant_id);

CREATE INDEX IF NOT EXISTS leave_approval_logs_tenant_idx
  ON app_data.leave_approval_logs (tenant_id);

-- leave_requests is exposed in the entity browser — important.
CREATE INDEX IF NOT EXISTS leave_requests_tenant_idx
  ON app_data.leave_requests (tenant_id);

-- Composite index for the common "pending leave by tenant" query.
CREATE INDEX IF NOT EXISTS leave_requests_tenant_status_idx
  ON app_data.leave_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS quarterly_reviews_tenant_idx
  ON app_data.quarterly_reviews (tenant_id);

CREATE INDEX IF NOT EXISTS quote_attachment_tenant_idx
  ON app_data.quote_attachment (tenant_id);

CREATE INDEX IF NOT EXISTS quote_line_item_tenant_idx
  ON app_data.quote_line_item (tenant_id);

CREATE INDEX IF NOT EXISTS quote_status_history_tenant_idx
  ON app_data.quote_status_history (tenant_id);

CREATE INDEX IF NOT EXISTS rotations_tenant_idx
  ON app_data.rotations (tenant_id);

CREATE INDEX IF NOT EXISTS schedule_change_logs_tenant_idx
  ON app_data.schedule_change_logs (tenant_id);

CREATE INDEX IF NOT EXISTS skills_ratings_tenant_idx
  ON app_data.skills_ratings (tenant_id);

CREATE INDEX IF NOT EXISTS tafe_calendars_tenant_idx
  ON app_data.tafe_calendars (tenant_id);

CREATE INDEX IF NOT EXISTS tender_enrichments_tenant_idx
  ON app_data.tender_enrichments (tenant_id);

CREATE INDEX IF NOT EXISTS tender_import_runs_tenant_idx
  ON app_data.tender_import_runs (tenant_id);

CREATE INDEX IF NOT EXISTS tender_nominations_tenant_idx
  ON app_data.tender_nominations (tenant_id);

CREATE INDEX IF NOT EXISTS tender_review_decisions_tenant_idx
  ON app_data.tender_review_decisions (tenant_id);

CREATE INDEX IF NOT EXISTS weekly_reports_tenant_idx
  ON app_data.weekly_reports (tenant_id);

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0015_missing_tenant_indices', NULL)
  ON CONFLICT (name) DO NOTHING;
