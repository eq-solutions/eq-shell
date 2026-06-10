-- ============================================================
-- Migration 0073: Scope coverage gaps — defect-like open items
--
-- Captures the "scope priced but no calendar entry covers it" finding from
-- the 2026-04-27 SKS / Equinix audit. Each gap is a first-class object with
-- a workflow state (open / resolved / accepted / deferred) so a manager can
-- work through them like a defect register, instead of:
--   - blocking calendar commit (too rigid for SKS's working style), or
--   - silently logging (gaps disappear, never get worked).
--
-- Auto-populated by the calendar commit operation (warn-only, NOT block):
-- when pm_calendar entries flip to draft_status='committed', any
-- contract_scopes row with year_totals[contract_year] > 0 and
-- billing_basis IN ('fixed','additional_item') that has no pm_calendar entry
-- referencing it gets a row inserted here. The calendar commit IS NOT BLOCKED
-- by uncovered scope (resolved 2026-04-27) — supervisor sees a red banner with
-- the gap list but commits anyway. Manager works the register over the year.
--
-- Audited examples (per hitlist):
--   - SY3 5YR cycle work due 2026 ($44.5k) - 3 gap rows
--   - SY9 priced annual scope without calendar entries (~$25-30k) - several rows
--   - AUHQ entire calendar missing - many rows
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scope_coverage_gaps (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id       uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_id           uuid        REFERENCES public.sites(id) ON DELETE SET NULL,
  contract_scope_id uuid        NOT NULL REFERENCES public.contract_scopes(id) ON DELETE CASCADE,
  contract_year     integer     NOT NULL,
  -- Denormalised gap detail (fast register queries without joins)
  jp_code           text,
  scope_description text,
  expected_amount   numeric(12,2),
  intervals_text    text,
  -- Workflow state
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'accepted', 'deferred')),
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('high', 'medium', 'low')),
  -- Auto-detection metadata
  detected_at       timestamptz NOT NULL DEFAULT now(),
  detected_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  detection_reason  text,
    -- e.g. 'committed_calendar_has_no_entry_referencing_this_scope'
  -- Resolution paths
  resolved_via_calendar_id uuid REFERENCES public.pm_calendar(id) ON DELETE SET NULL,
  resolved_at              timestamptz,
  resolved_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes         text,
  -- Acceptance path (deliberate decision not to schedule)
  accepted_reason          text,
  accepted_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at              timestamptz,
  -- Deferral path (push to next year)
  deferred_to_year         integer,
  deferred_reason          text,
  -- Standard tail
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- Unique per scope per year per customer (one open gap, no duplicates)
  CONSTRAINT scope_coverage_gaps_unique
    UNIQUE (contract_scope_id, contract_year)
);

CREATE INDEX scope_coverage_gaps_tenant_idx
  ON public.scope_coverage_gaps(tenant_id);

CREATE INDEX scope_coverage_gaps_customer_idx
  ON public.scope_coverage_gaps(customer_id);

-- The register view: "show me open gaps for this customer"
CREATE INDEX scope_coverage_gaps_open_idx
  ON public.scope_coverage_gaps(tenant_id, customer_id, status)
  WHERE status = 'open' AND is_active = true;

-- Severity filter: "show me high-severity open gaps"
CREATE INDEX scope_coverage_gaps_severity_idx
  ON public.scope_coverage_gaps(tenant_id, severity, status)
  WHERE is_active = true;

CREATE TRIGGER set_scope_coverage_gaps_updated_at
  BEFORE UPDATE ON public.scope_coverage_gaps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Severity auto-set trigger
-- Resolved 2026-04-27: thresholds hard-coded.
--   high   = expected_amount >  10_000
--   medium = expected_amount IN (1_000, 10_000]
--   low    = expected_amount <= 1_000  (or NULL)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_scope_coverage_gap_severity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expected_amount IS NULL THEN
    NEW.severity := 'low';
  ELSIF NEW.expected_amount > 10000 THEN
    NEW.severity := 'high';
  ELSIF NEW.expected_amount > 1000 THEN
    NEW.severity := 'medium';
  ELSE
    NEW.severity := 'low';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scope_coverage_gaps_severity
  BEFORE INSERT OR UPDATE OF expected_amount ON public.scope_coverage_gaps
  FOR EACH ROW EXECUTE FUNCTION public.set_scope_coverage_gap_severity();

-- ------------------------------------------------------------
-- Accept-role gate
-- Resolved 2026-04-27: only super_admin / admin can mark a gap as accepted.
-- Supervisor can resolve (with a calendar entry) or defer, but cannot
-- self-clear via accept. Accepting = "$X of priced work won't be done this
-- year" — that's a commercial decision, manager-level only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_scope_coverage_gap_accept_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only fire when accepted_at flips from NULL to non-NULL, or accepted_by changes
  IF (OLD.accepted_at IS DISTINCT FROM NEW.accepted_at)
     OR (OLD.accepted_by IS DISTINCT FROM NEW.accepted_by)
     OR (OLD.accepted_reason IS DISTINCT FROM NEW.accepted_reason)
     OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted')
  THEN
    v_role := public.get_user_role(NEW.tenant_id);
    IF v_role NOT IN ('super_admin', 'admin') THEN
      RAISE EXCEPTION 'role % cannot accept a scope coverage gap; admin or above required', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scope_coverage_gaps_accept_role_gate
  BEFORE UPDATE ON public.scope_coverage_gaps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scope_coverage_gap_accept_role();

ALTER TABLE public.scope_coverage_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY scope_coverage_gaps_select ON public.scope_coverage_gaps
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY scope_coverage_gaps_insert ON public.scope_coverage_gaps
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY scope_coverage_gaps_update ON public.scope_coverage_gaps
  FOR UPDATE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY scope_coverage_gaps_delete ON public.scope_coverage_gaps
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

COMMENT ON TABLE public.scope_coverage_gaps IS
  'Defect-like register of contract scope rows with no calendar entry covering them. Auto-populated when a calendar commits. Manager works through gaps over the year.';

COMMENT ON COLUMN public.scope_coverage_gaps.status IS
  'open = needs action; resolved = a calendar entry now covers this scope; accepted = deliberate decision not to schedule (e.g. carved out at commercial review); deferred = pushed to a later year';

COMMENT ON COLUMN public.scope_coverage_gaps.severity IS
  'Auto-set by trigger from expected_amount: high = >$10k, medium = $1k-$10k, low = <=$1k or NULL. Trigger fires BEFORE INSERT and BEFORE UPDATE OF expected_amount. Manual override possible only by directly UPDATEing severity (does not re-fire the auto-set).';

COMMENT ON COLUMN public.scope_coverage_gaps.accepted_by IS
  'User who accepted the gap. Trigger enforces this can only be set by super_admin or admin role; supervisor cannot self-accept (resolved 2026-04-27 — accepting is a commercial decision).';
