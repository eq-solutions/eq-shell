-- Migration: 0044_tender_nomination_clashes_rls
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Enable RLS on app_data.tender_nomination_clashes and add the
--            standard tenant_isolation ALL policy to close the drift gap
--            found on ehowgjardagevnrluult (SKS entity plane) where the
--            table was created without RLS — the only app_data table missing
--            it across all planes.
--
-- WHY: check-tenant-drift.mjs CHECK 4 enforces RLS ON for every app_data
--   table on every plane absolutely. tender_nomination_clashes was created
--   without ALTER TABLE ... ENABLE ROW LEVEL SECURITY, leaving it the sole
--   exception. This migration brings it in line with every other app_data
--   table and satisfies the drift gate.
--
-- Safe: enabling RLS on a table accessed via service_role has no practical
--   impact — service_role bypasses RLS. The policy below is the standard
--   tenant-scoping guard applied to every app_data table; it has no effect
--   on service_role callers and prevents any misrouted JWT from reading
--   another tenant's clash records.
-- The runner records the ledger row on apply; this file writes no ledger row.

ALTER TABLE app_data.tender_nomination_clashes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tender_nomination_clashes_tenant_isolation
  ON app_data.tender_nomination_clashes;

CREATE POLICY tender_nomination_clashes_tenant_isolation
  ON app_data.tender_nomination_clashes
  AS PERMISSIVE FOR ALL
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  );
