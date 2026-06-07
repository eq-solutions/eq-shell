-- 0044_contact_customer_links_with_check.sql
--
-- Adds an explicit WITH CHECK clause to the ALL policy on
-- app_data.contact_customer_links so the write path explicitly
-- enforces tenant isolation rather than relying on USING-as-fallback.
--
-- The USING predicate is identical — this is a policy hygiene fix.
-- No data change; no new restriction. Safe to apply idempotently.
--
-- Applied directly to sks-canonical (ehow) on 2026-06-08 during the
-- Phase 5 hardening pass. This migration propagates it to future
-- tenant planes via the One Pipe.

DROP POLICY IF EXISTS ccl_tenant ON app_data.contact_customer_links;
CREATE POLICY ccl_tenant ON app_data.contact_customer_links
  FOR ALL
  USING      (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
