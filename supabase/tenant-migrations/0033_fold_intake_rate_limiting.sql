-- =============================================================================
-- Migration 0033: Fold intake rate-limiting into the spine
--
-- Step 4 of schema governance (SCHEMA-GOVERNANCE.md) + One Spine consolidation.
-- The intake rate-limit infrastructure was authored OUT-OF-BAND in eq-intake
-- (sql/029_rate_limiting.sql) and never entered the eq-shell tenant lineage.
-- Consequence found 2026-06-03 (verified read-only on live tenants):
--   • The SKS tenant (ehow) has the two RPCs but NOT their backing table
--     app_data.eq_intake_rate_limits — so the api-intake edge function's
--     pre-commit eq_check_intake_rate_limit() would error there. Latent today
--     (the public api-intake endpoint has 0 calls on every tenant) but it
--     breaks the moment that endpoint is enabled for SKS.
--   • A tenant freshly provisioned by the eq-shell runner would get NEITHER
--     table NOR RPCs, because none of this lived in the spine.
--
-- This migration re-asserts the COMPLETE rate-limit infra idempotently so every
-- tenant (existing + future) is uniform. No-op where already present; adds the
-- table on SKS; gives fresh tenants the full set. Faithful to eq-intake/029.
--
-- NOTE (tracked follow-up, deliberately NOT changed here): the RLS policy gates
-- on user_metadata->>'tenant_id', whereas the canonical convention is
-- app_metadata. Kept as-is so this migration stays purely additive and matches
-- the table the EQ tenant already has. The user_metadata→app_metadata move is a
-- cross-cutting RLS concern (other objects share it) and belongs in its own
-- canonicalisation sweep, not a one-off here. The RPCs run SECURITY DEFINER via
-- service_role, so this policy does not gate the actual write path regardless.
-- =============================================================================

BEGIN;

-- ── Rolling-window store ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_data.eq_intake_rate_limits (
  id          BIGSERIAL   PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eq_intake_rate_limits_tenant_time_idx
  ON app_data.eq_intake_rate_limits (tenant_id, recorded_at DESC);

ALTER TABLE app_data.eq_intake_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON app_data.eq_intake_rate_limits;
CREATE POLICY "tenant_isolation"
  ON app_data.eq_intake_rate_limits
  FOR ALL
  USING (
    tenant_id = ((auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid)
  );

-- ── Check RPC: true = under the limit; prunes stale rows as a side-effect ─────
CREATE OR REPLACE FUNCTION app_data.eq_check_intake_rate_limit(
  p_tenant_id      UUID,
  p_window_minutes INT DEFAULT 60,
  p_max_calls      INT DEFAULT 50
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_call_count   INT;
BEGIN
  v_window_start := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  SELECT COUNT(*)
    INTO v_call_count
    FROM app_data.eq_intake_rate_limits
   WHERE tenant_id   = p_tenant_id
     AND recorded_at >= v_window_start;

  DELETE FROM app_data.eq_intake_rate_limits
   WHERE tenant_id   = p_tenant_id
     AND recorded_at < NOW() - ((p_window_minutes * 2) || ' minutes')::INTERVAL;

  RETURN v_call_count < p_max_calls;
END;
$$;

COMMENT ON FUNCTION app_data.eq_check_intake_rate_limit IS
  'Returns true if the tenant has not exceeded p_max_calls in the last '
  'p_window_minutes minutes. Also prunes stale rows as a side-effect.';

-- ── Increment RPC: record one intake call after a successful commit ──────────
CREATE OR REPLACE FUNCTION app_data.eq_increment_intake_rate_limit(
  p_tenant_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO app_data.eq_intake_rate_limits (tenant_id, recorded_at)
  VALUES (p_tenant_id, NOW());
END;
$$;

COMMENT ON FUNCTION app_data.eq_increment_intake_rate_limit IS
  'Record one intake call for the tenant. Call after a successful commit.';

GRANT EXECUTE ON FUNCTION app_data.eq_check_intake_rate_limit     TO authenticated;
GRANT EXECUTE ON FUNCTION app_data.eq_increment_intake_rate_limit TO authenticated;

COMMIT;
