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
-- Idempotent (CREATE ... IF NOT EXISTS) and forward-only. A lone partial-unique
-- index needs no transaction wrap, so this file has none.
--
-- The runner (scripts/migrate-tenants.mjs) is the SINGLE writer of
-- app_data._eq_migrations and records this file's ledger row under its full
-- filename (with checksum) on apply. This file therefore inserts NO ledger row of
-- its own — a self-insert would write a bare-named, null-checksum twin the runner
-- never reconciles (see SCHEMA-GOVERNANCE.md → "Ledger truth: the runner records,
-- the file does not", and scripts/check-migration-hygiene.mjs).

CREATE UNIQUE INDEX IF NOT EXISTS jobs_tenant_external_id_uidx
  ON app_data.jobs (tenant_id, external_id) WHERE external_id IS NOT NULL;
