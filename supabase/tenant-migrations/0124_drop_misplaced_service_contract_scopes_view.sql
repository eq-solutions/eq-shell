-- 0124_drop_misplaced_service_contract_scopes_view.sql
--
-- Remove app_data.service_contract_scopes. Migration 0123 originally (and wrongly)
-- created this EQ Service read-bridge as a view in app_data. Two problems:
--   1. Wrong schema. EQ Service's client pins db.schema='service', so the bridge
--      must be `service.contract_scopes` (applied to the SKS tenant's service
--      schema as part of the cutover-shim layer, outside the One Pipe) — an
--      app_data view is never read by the app.
--   2. As an app_data security_invoker view granted SELECT to authenticated with
--      no RLS of its own, it tripped the anon-grant security invariant
--      (check-tenant-drift.mjs: "table with unconstrained anon access, rls-disabled").
--
-- 0123 no longer creates it. This drops it from any tenant where the original
-- 0123 already did (zaap / eq-canonical-internal). Idempotent no-op elsewhere.

DROP VIEW IF EXISTS app_data.service_contract_scopes;
