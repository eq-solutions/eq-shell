-- Migration: 0040_jobs_canonical_upsert_index
-- Target:    Per-tenant data plane (every tenant Supabase project)
-- Purpose:   Make app_data.jobs upsertable through canonical-api's PUT handler.
--            The handler resolves an existing row by (tenant_id, external_id) and
--            falls back to INSERT, relying on a UNIQUE partial index to make the
--            create idempotent under concurrency (the 23505 re-resolve path).
--            customers/sites/contacts got this index in 0022; `jobs` was exposed
--            read-only and never had a writer, so it lacked the index. This adds
--            it so the operational work-order spine — 'quote.accepted -> PUT jobs',
--            keyed on external_id = the originating quote — can land idempotently.
--
-- Idempotent (IF NOT EXISTS) + forward-only. Mirrors 0022's index DDL exactly.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_tenant_external_id_uidx
  ON app_data.jobs (tenant_id, external_id) WHERE external_id IS NOT NULL;

INSERT INTO app_data._eq_migrations(name, checksum)
VALUES ('0040_jobs_canonical_upsert_index', NULL)
ON CONFLICT (name) DO NOTHING;

COMMIT;
