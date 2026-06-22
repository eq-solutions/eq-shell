-- 0140_service_enable_all_canonical.sql
--
-- service.customers and service.sites views filter WHERE service_enabled = true.
-- During bulk import from legacy systems, records were inserted with
-- service_enabled = false by default. Now that EQ Service is the primary CMMS
-- for SKS, all canonical customers and sites should be visible in Service.
--
-- Dispatch with slug=sks (ehow only).

UPDATE app_data.customers SET service_enabled = true WHERE service_enabled = false;
UPDATE app_data.sites     SET service_enabled = true WHERE service_enabled = false;
