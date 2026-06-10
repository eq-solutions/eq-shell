-- ============================================================
-- Migration 0028: Mutation ID Idempotency
--
-- Adds a client-generated `mutation_id` column to `audit_logs`
-- so that server actions can be safely replayed (offline sync,
-- AI-suggested actions, network retries) without duplicating
-- writes. Uniqueness is scoped per tenant to avoid cross-tenant
-- collisions on what are effectively UUIDs anyway.
--
-- The column is nullable so that existing mutations that do not
-- yet opt into idempotency continue to work unchanged.
-- ============================================================

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS mutation_id text;

-- Partial unique index — only enforced where mutation_id is set.
-- Scoped to tenant_id because the id is client-generated and we
-- never want one tenant's replay to collide with another's.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_mutation_id_unique
  ON public.audit_logs (tenant_id, mutation_id)
  WHERE mutation_id IS NOT NULL;

COMMENT ON COLUMN public.audit_logs.mutation_id IS
  'Optional client-generated UUID used to make server actions idempotent. '
  'If set, the (tenant_id, mutation_id) pair must be unique. '
  'Used by offline sync replay and AI-suggested actions.';
