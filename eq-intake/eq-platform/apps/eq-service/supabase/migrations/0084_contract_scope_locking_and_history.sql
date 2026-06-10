-- ============================================================
-- Migration 0084: contract scope period-locking + per-row history
--
-- Phase 5 of the contract-scope ↔ maintenance-check bridge plan, prioritised
-- ahead of the field-tech features by commercial-manager review (audit
-- defensibility before behaviour change).
--
-- Three pieces:
--
-- 1. period_status column on contract_scopes — draft / committed / locked /
--    archived. Existing rows default to 'committed' so nothing changes for
--    legacy data. Year-end close flips to 'locked' which makes the row
--    immutable except via super_admin override.
--
-- 2. contract_scopes_history table + AFTER INSERT/UPDATE/DELETE trigger
--    that captures every change with before/after JSON snapshots and the
--    list of changed fields. Admin+ read; only the trigger writes
--    (SECURITY DEFINER).
--
-- 3. enforce_contract_scope_lock BEFORE UPDATE/DELETE trigger that blocks
--    mutations on rows where period_status='locked'. Super-admin bypasses
--    (with audit trail via the history trigger).
--
-- Importer-side: when wipe_and_replace_contract_scopes (0083) attempts to
-- DELETE a locked row, the lock-gate trigger raises 42501 and the entire
-- atomic transaction rolls back — the importer fails cleanly with a
-- "row is locked" message rather than half-applying.
-- ============================================================

-- ── 1. period_status column ─────────────────────────────────────────────

ALTER TABLE public.contract_scopes
  ADD COLUMN IF NOT EXISTS period_status text NOT NULL DEFAULT 'committed'
    CHECK (period_status IN ('draft', 'committed', 'locked', 'archived'));

COMMENT ON COLUMN public.contract_scopes.period_status IS
  'Lifecycle stage. draft = under construction (operator setting up year); committed = finalised, in use, editable with audit trail; locked = closed period, immutable except super_admin; archived = soft-deleted, hidden from active queries.';

-- Filter index for "show me anything not in committed state".
CREATE INDEX IF NOT EXISTS contract_scopes_period_status_idx
  ON public.contract_scopes(tenant_id, period_status)
  WHERE period_status != 'committed';

-- ── 2. History table + capture trigger ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_scopes_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id        uuid        NOT NULL,
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  site_id         uuid        REFERENCES public.sites(id) ON DELETE SET NULL,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  changed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  change_kind     text        NOT NULL
    CHECK (change_kind IN ('insert', 'update', 'delete', 'lock', 'unlock', 'archive')),
  before_snapshot jsonb,
  after_snapshot  jsonb,
  diff_fields     text[],
  reason          text
  -- No FK from scope_id → contract_scopes(id) on purpose: when a scope row
  -- is hard-deleted (e.g. by the importer's wipe), we want the history row
  -- to survive as evidence. Querying "show me history for scope X" works
  -- via the column directly.
);

CREATE INDEX contract_scopes_history_scope_idx
  ON public.contract_scopes_history(scope_id, changed_at DESC);
CREATE INDEX contract_scopes_history_tenant_idx
  ON public.contract_scopes_history(tenant_id, changed_at DESC);
CREATE INDEX contract_scopes_history_customer_idx
  ON public.contract_scopes_history(customer_id, changed_at DESC)
  WHERE customer_id IS NOT NULL;

ALTER TABLE public.contract_scopes_history ENABLE ROW LEVEL SECURITY;

-- Read: admin+ on the parent tenant. No write policies — only the
-- AFTER trigger writes (SECURITY DEFINER bypasses RLS for inserts).
CREATE POLICY contract_scopes_history_select ON public.contract_scopes_history
  FOR SELECT USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

-- Capture trigger function. Records every INSERT/UPDATE/DELETE with a
-- before/after JSONB snapshot + list of changed fields. SECURITY DEFINER
-- so it can write to a table the caller can't write to directly.
CREATE OR REPLACE FUNCTION public.capture_contract_scope_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id        uuid;
  v_changed_fields text[];
  v_kind           text;
BEGIN
  -- auth.uid() is null for trigger fired outside an authenticated request
  -- (e.g. service-role cleanups). Capture it best-effort.
  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contract_scopes_history (
      scope_id, tenant_id, customer_id, site_id, changed_by, change_kind,
      before_snapshot, after_snapshot, diff_fields
    ) VALUES (
      NEW.id, NEW.tenant_id, NEW.customer_id, NEW.site_id, v_user_id, 'insert',
      NULL, to_jsonb(NEW), NULL
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Compute the set of columns whose value actually changed.
    SELECT array_agg(key)
      INTO v_changed_fields
      FROM (
        SELECT k AS key
          FROM jsonb_each(to_jsonb(OLD)) old_kv(k, v_old)
          JOIN jsonb_each(to_jsonb(NEW)) new_kv(k2, v_new) ON old_kv.k = new_kv.k2
         WHERE old_kv.v_old IS DISTINCT FROM new_kv.v_new
           AND old_kv.k NOT IN ('updated_at')  -- noise
      ) s;

    -- No-op update (only updated_at touched) — skip.
    IF v_changed_fields IS NULL OR array_length(v_changed_fields, 1) = 0 THEN
      RETURN NEW;
    END IF;

    -- Specialise the change_kind for status transitions so the history is
    -- easy to query for lock/unlock events.
    v_kind := CASE
      WHEN OLD.period_status IS DISTINCT FROM NEW.period_status AND NEW.period_status = 'locked'   THEN 'lock'
      WHEN OLD.period_status IS DISTINCT FROM NEW.period_status AND OLD.period_status = 'locked'   THEN 'unlock'
      WHEN OLD.period_status IS DISTINCT FROM NEW.period_status AND NEW.period_status = 'archived' THEN 'archive'
      ELSE 'update'
    END;

    INSERT INTO public.contract_scopes_history (
      scope_id, tenant_id, customer_id, site_id, changed_by, change_kind,
      before_snapshot, after_snapshot, diff_fields
    ) VALUES (
      NEW.id, NEW.tenant_id, NEW.customer_id, NEW.site_id, v_user_id, v_kind,
      to_jsonb(OLD), to_jsonb(NEW), v_changed_fields
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.contract_scopes_history (
      scope_id, tenant_id, customer_id, site_id, changed_by, change_kind,
      before_snapshot, after_snapshot, diff_fields
    ) VALUES (
      OLD.id, OLD.tenant_id, OLD.customer_id, OLD.site_id, v_user_id, 'delete',
      to_jsonb(OLD), NULL, NULL
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.capture_contract_scope_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contract_scopes_history_trigger ON public.contract_scopes;
CREATE TRIGGER contract_scopes_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_scopes
  FOR EACH ROW EXECUTE FUNCTION public.capture_contract_scope_history();

COMMENT ON TABLE public.contract_scopes_history IS
  'Per-row history for contract_scopes. Captured by AFTER trigger. Admin+ read only; the trigger writes via SECURITY DEFINER. Survives parent row deletion (no FK cascade) so wipe events leave evidence.';

-- ── 3. Lock-protection trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_contract_scope_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.get_user_role(COALESCE(OLD.tenant_id, NEW.tenant_id));

  -- super_admin bypass — but the AFTER history trigger still records the
  -- change, so no audit gap.
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

DROP TRIGGER IF EXISTS contract_scopes_lock_gate ON public.contract_scopes;
CREATE TRIGGER contract_scopes_lock_gate
  BEFORE UPDATE OR DELETE ON public.contract_scopes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contract_scope_lock();

COMMENT ON FUNCTION public.enforce_contract_scope_lock IS
  'BEFORE UPDATE/DELETE gate on contract_scopes. Blocks mutations on locked rows for everyone except super_admin. Importer wipe (0083) hits this and fails atomically.';
