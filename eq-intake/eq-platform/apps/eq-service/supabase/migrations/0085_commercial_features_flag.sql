-- ============================================================
-- Migration 0085: Commercial-features tenant flag
--
-- Splits the contract-scope bridge plan into two tiers:
--
--   - "Universal" tier (Phases 1-3 from the bridge plan):
--       scope-context display on maintenance checks, auto gap-close on
--       check completion, block out-of-scope creation. Always on for
--       every tenant — every electrical contractor benefits from techs
--       knowing what's contracted vs out of scope.
--
--   - "Commercial" tier (Phases 4-8 — variations register, period-locking
--     + audit history, service-credit calc, renewal pack generator,
--     customer-visible scope statement). Per-tenant feature flag —
--     useful for corporate-side commercial managers (Linesight-shaped
--     organisations) but overhead for small electrical contractors.
--
-- Royce's feedback after the commercial-manager review: SKS NSW (his own
-- shop) won't use the commercial layer day-to-day. Gate it so the
-- complexity stays out of their way unless they switch it on per tenant.
--
-- Phase 5 (locking + history) was applied in 0084. This migration:
--   - Adds the tenant_settings column
--   - Adds a helper fn the lock-gate consults
--   - Replaces enforce_contract_scope_lock so it no-ops when the flag is
--     off, preserving SKS NSW's historical UPDATE/DELETE behaviour
--
-- The history trigger from 0084 (capture_contract_scope_history) stays
-- universal. Capturing per-row history is cheap and the forensic data is
-- useful regardless of which tier the tenant is on — corporates surface
-- it via UI, others can query it ad-hoc when needed.
-- ============================================================

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS commercial_features_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenant_settings.commercial_features_enabled IS
  'When true, the commercial-tier features activate for this tenant: contract-scope period-locking + audit history view, variations register, service-credit risk surfacing, renewal pack generator, customer-facing scope statement. When false (default) only the universal tier (scope-context display on checks, auto gap-close, out-of-scope block) is active. Switch on per tenant via /admin/settings.';

-- Helper fn — single source of truth for "is this tenant on the commercial
-- tier?". SECURITY DEFINER so triggers and RLS expressions can call it
-- regardless of the caller's role.
CREATE OR REPLACE FUNCTION public.tenant_has_commercial_features(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT commercial_features_enabled
       FROM public.tenant_settings
      WHERE tenant_id = p_tenant_id
      LIMIT 1),
    false
  );
$$;

-- Helper is only called from inside the SECURITY DEFINER trigger
-- (enforce_contract_scope_lock), which runs as the function owner — no
-- direct invocation by authenticated users needed. Revoke broadly to
-- keep it off the /rest/v1/rpc surface.
REVOKE EXECUTE ON FUNCTION public.tenant_has_commercial_features(uuid) FROM PUBLIC, anon, authenticated;

-- Replace the lock-gate. Same shape as 0084's version, plus a flag check
-- at the top — when commercial features are off for the tenant, the
-- gate no-ops and UPDATE/DELETE on contract_scopes behaves exactly as it
-- did before 0084. Importer wipes pass through. SKS NSW continues
-- unchanged.
CREATE OR REPLACE FUNCTION public.enforce_contract_scope_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role      text;
  v_tenant_id uuid := COALESCE(OLD.tenant_id, NEW.tenant_id);
BEGIN
  -- Tenant opt-out: no-op. Locking is a commercial-tier feature and
  -- shouldn't surprise tenants that haven't enabled it.
  IF NOT public.tenant_has_commercial_features(v_tenant_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- super_admin bypass — but the AFTER history trigger (universal,
  -- always on) still records the change so there's no audit gap.
  v_role := public.get_user_role(v_tenant_id);
  IF v_role = 'super_admin' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.period_status = 'locked' THEN
      RAISE EXCEPTION
        'contract_scopes row % (jp_code=%, year=%) is locked. Unlock via super_admin first.',
        OLD.id, OLD.jp_code, OLD.financial_year
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.period_status = 'locked' THEN
      RAISE EXCEPTION
        'contract_scopes row % (jp_code=%, year=%) is locked and cannot be deleted. Unlock via super_admin first.',
        OLD.id, OLD.jp_code, OLD.financial_year
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_contract_scope_lock() FROM PUBLIC, anon, authenticated;

-- (Trigger from 0084 already references this function name — CREATE OR
-- REPLACE swaps the body, no DROP/CREATE needed.)
