-- ============================================================
-- 0042_fk_covering_indexes.sql
--
-- Add covering indexes for every foreign key in the `public`
-- schema that currently lacks one. Flagged by Supabase advisor
-- `unindexed_foreign_keys` and by a direct pg_constraint scan
-- on 2026-04-15. ~80 FKs total.
--
-- Why: unindexed FKs force a sequential scan on the referencing
-- table whenever the referenced row is deleted, updated, or
-- joined. It also hurts common read patterns (e.g. "all tests
-- for this asset", "all assets for this site"). Every index
-- here covers exactly the FK columns so the planner can use
-- it for both FK integrity checks and the app's filter queries.
--
-- Regular (non-concurrent) CREATE INDEX is used — this migration
-- runs in a transaction, and the referencing tables are small
-- enough (largest ~1250 rows) that a brief lock is not a
-- concern. Re-running is safe via IF NOT EXISTS.
--
-- No schema or data changes. Pure performance pass.
-- ============================================================

-- acb_test_readings
create index if not exists idx_acb_test_readings_acb_test_id on public.acb_test_readings(acb_test_id);
create index if not exists idx_acb_test_readings_tenant_id on public.acb_test_readings(tenant_id);

-- acb_tests
create index if not exists idx_acb_tests_asset_id on public.acb_tests(asset_id);
create index if not exists idx_acb_tests_site_id on public.acb_tests(site_id);
create index if not exists idx_acb_tests_tenant_id on public.acb_tests(tenant_id);
create index if not exists idx_acb_tests_tested_by on public.acb_tests(tested_by);
create index if not exists idx_acb_tests_testing_check_id on public.acb_tests(testing_check_id);

-- assets
create index if not exists idx_assets_job_plan_id on public.assets(job_plan_id);
create index if not exists idx_assets_site_id on public.assets(site_id);
create index if not exists idx_assets_tenant_id on public.assets(tenant_id);

-- attachments
create index if not exists idx_attachments_tenant_id on public.attachments(tenant_id);
create index if not exists idx_attachments_uploaded_by on public.attachments(uploaded_by);

-- audit_logs
create index if not exists idx_audit_logs_tenant_id on public.audit_logs(tenant_id);
create index if not exists idx_audit_logs_user_id on public.audit_logs(user_id);

-- briefs
create index if not exists idx_briefs_estimate_id on public.briefs(estimate_id);

-- check_assets
create index if not exists idx_check_assets_asset_id on public.check_assets(asset_id);
create index if not exists idx_check_assets_check_id on public.check_assets(check_id);
create index if not exists idx_check_assets_tenant_id on public.check_assets(tenant_id);

-- contract_scopes
create index if not exists idx_contract_scopes_customer_id on public.contract_scopes(customer_id);
create index if not exists idx_contract_scopes_site_id on public.contract_scopes(site_id);
create index if not exists idx_contract_scopes_tenant_id on public.contract_scopes(tenant_id);

-- customer_contacts
create index if not exists idx_customer_contacts_customer_id on public.customer_contacts(customer_id);
create index if not exists idx_customer_contacts_tenant_id on public.customer_contacts(tenant_id);

-- customers
create index if not exists idx_customers_tenant_id on public.customers(tenant_id);

-- defects
create index if not exists idx_defects_asset_id on public.defects(asset_id);
create index if not exists idx_defects_assigned_to on public.defects(assigned_to);
create index if not exists idx_defects_check_asset_id on public.defects(check_asset_id);
create index if not exists idx_defects_check_id on public.defects(check_id);
create index if not exists idx_defects_raised_by on public.defects(raised_by);
create index if not exists idx_defects_resolved_by on public.defects(resolved_by);
create index if not exists idx_defects_site_id on public.defects(site_id);
create index if not exists idx_defects_tenant_id on public.defects(tenant_id);

-- instruments
create index if not exists idx_instruments_assigned_to on public.instruments(assigned_to);
create index if not exists idx_instruments_tenant_id on public.instruments(tenant_id);

-- job_plan_items
create index if not exists idx_job_plan_items_asset_id on public.job_plan_items(asset_id);
create index if not exists idx_job_plan_items_job_plan_id on public.job_plan_items(job_plan_id);
create index if not exists idx_job_plan_items_tenant_id on public.job_plan_items(tenant_id);

-- job_plans
create index if not exists idx_job_plans_site_id on public.job_plans(site_id);
create index if not exists idx_job_plans_tenant_id on public.job_plans(tenant_id);

-- maintenance_check_items
create index if not exists idx_maintenance_check_items_asset_id on public.maintenance_check_items(asset_id);
create index if not exists idx_maintenance_check_items_check_asset_id on public.maintenance_check_items(check_asset_id);
create index if not exists idx_maintenance_check_items_check_id on public.maintenance_check_items(check_id);
create index if not exists idx_maintenance_check_items_completed_by on public.maintenance_check_items(completed_by);
create index if not exists idx_maintenance_check_items_job_plan_item_id on public.maintenance_check_items(job_plan_item_id);
create index if not exists idx_maintenance_check_items_tenant_id on public.maintenance_check_items(tenant_id);

-- maintenance_checks
create index if not exists idx_maintenance_checks_assigned_to on public.maintenance_checks(assigned_to);
create index if not exists idx_maintenance_checks_job_plan_id on public.maintenance_checks(job_plan_id);
create index if not exists idx_maintenance_checks_site_id on public.maintenance_checks(site_id);
create index if not exists idx_maintenance_checks_tenant_id on public.maintenance_checks(tenant_id);

-- media_library
create index if not exists idx_media_library_tenant_id on public.media_library(tenant_id);
create index if not exists idx_media_library_uploaded_by on public.media_library(uploaded_by);

-- mfa_recovery_codes
create index if not exists idx_mfa_recovery_codes_user_id on public.mfa_recovery_codes(user_id);

-- notifications
create index if not exists idx_notifications_tenant_id on public.notifications(tenant_id);
create index if not exists idx_notifications_user_id on public.notifications(user_id);

-- nsx_test_readings
create index if not exists idx_nsx_test_readings_nsx_test_id on public.nsx_test_readings(nsx_test_id);
create index if not exists idx_nsx_test_readings_tenant_id on public.nsx_test_readings(tenant_id);

-- nsx_tests
create index if not exists idx_nsx_tests_asset_id on public.nsx_tests(asset_id);
create index if not exists idx_nsx_tests_site_id on public.nsx_tests(site_id);
create index if not exists idx_nsx_tests_tenant_id on public.nsx_tests(tenant_id);
create index if not exists idx_nsx_tests_tested_by on public.nsx_tests(tested_by);
create index if not exists idx_nsx_tests_testing_check_id on public.nsx_tests(testing_check_id);

-- pm_calendar
create index if not exists idx_pm_calendar_assigned_to on public.pm_calendar(assigned_to);
create index if not exists idx_pm_calendar_recurrence_parent_id on public.pm_calendar(recurrence_parent_id);
create index if not exists idx_pm_calendar_site_id on public.pm_calendar(site_id);
create index if not exists idx_pm_calendar_tenant_id on public.pm_calendar(tenant_id);

-- site_contacts
create index if not exists idx_site_contacts_site_id on public.site_contacts(site_id);
create index if not exists idx_site_contacts_tenant_id on public.site_contacts(tenant_id);

-- sites
create index if not exists idx_sites_customer_id on public.sites(customer_id);
create index if not exists idx_sites_tenant_id on public.sites(tenant_id);

-- tenant_members
create index if not exists idx_tenant_members_tenant_id on public.tenant_members(tenant_id);
create index if not exists idx_tenant_members_user_id on public.tenant_members(user_id);

-- tenant_settings
create index if not exists idx_tenant_settings_tenant_id on public.tenant_settings(tenant_id);

-- test_record_readings
create index if not exists idx_test_record_readings_tenant_id on public.test_record_readings(tenant_id);
create index if not exists idx_test_record_readings_test_record_id on public.test_record_readings(test_record_id);

-- test_records
create index if not exists idx_test_records_asset_id on public.test_records(asset_id);
create index if not exists idx_test_records_site_id on public.test_records(site_id);
create index if not exists idx_test_records_tenant_id on public.test_records(tenant_id);
create index if not exists idx_test_records_tested_by on public.test_records(tested_by);

-- testing_checks
create index if not exists idx_testing_checks_created_by on public.testing_checks(created_by);
create index if not exists idx_testing_checks_job_plan_id on public.testing_checks(job_plan_id);
create index if not exists idx_testing_checks_site_id on public.testing_checks(site_id);
create index if not exists idx_testing_checks_tenant_id on public.testing_checks(tenant_id);
