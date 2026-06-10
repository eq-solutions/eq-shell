-- 0010: Performance indexes for common query patterns
-- Sprint 17 — Beta readiness

-- Customers: tenant + active filter (used by every list query)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_active ON customers(tenant_id, is_active);

-- Sites: tenant + active + customer
CREATE INDEX IF NOT EXISTS idx_sites_tenant_active ON sites(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id) WHERE is_active = true;

-- Assets: tenant + active + site + type (most common filter combo)
CREATE INDEX IF NOT EXISTS idx_assets_tenant_active ON assets(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_assets_site_active ON assets(site_id, is_active);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type) WHERE is_active = true;

-- Job plans: tenant + active + site
CREATE INDEX IF NOT EXISTS idx_job_plans_tenant_active ON job_plans(tenant_id, is_active);

-- Maintenance checks: status + due date (dashboard + overdue detection)
CREATE INDEX IF NOT EXISTS idx_checks_status ON maintenance_checks(status);
CREATE INDEX IF NOT EXISTS idx_checks_due_date ON maintenance_checks(due_date);
CREATE INDEX IF NOT EXISTS idx_checks_assigned ON maintenance_checks(assigned_to) WHERE status IN ('scheduled', 'in_progress');

-- Test records: tenant + active + result + site
CREATE INDEX IF NOT EXISTS idx_test_records_tenant_active ON test_records(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_test_records_result ON test_records(result) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_test_records_site ON test_records(site_id) WHERE is_active = true;

-- ACB tests: tenant + active + site + result
CREATE INDEX IF NOT EXISTS idx_acb_tests_tenant_active ON acb_tests(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_acb_tests_site ON acb_tests(site_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_acb_tests_result ON acb_tests(overall_result) WHERE is_active = true;

-- ACB readings: test FK for joins
CREATE INDEX IF NOT EXISTS idx_acb_readings_test ON acb_test_readings(acb_test_id);

-- NSX tests: tenant + active + site + result
CREATE INDEX IF NOT EXISTS idx_nsx_tests_tenant_active ON nsx_tests(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_nsx_tests_site ON nsx_tests(site_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_nsx_tests_result ON nsx_tests(overall_result) WHERE is_active = true;

-- NSX readings: test FK for joins
CREATE INDEX IF NOT EXISTS idx_nsx_readings_test ON nsx_test_readings(nsx_test_id);

-- Instruments: calibration due date for overdue detection
CREATE INDEX IF NOT EXISTS idx_instruments_tenant_active ON instruments(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_instruments_cal_due ON instruments(calibration_due) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_instruments_status ON instruments(status) WHERE is_active = true;

-- Attachments: entity lookup (polymorphic)
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

-- Tenant members: user lookup (used by requireUser on every request)
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_active ON tenant_members(user_id, is_active);
