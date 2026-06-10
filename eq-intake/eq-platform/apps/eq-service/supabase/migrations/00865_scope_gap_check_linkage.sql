-- ============================================================
-- Migration 0086: Phase 2 of the contract-scope ↔ check bridge
--
-- When a maintenance_check completes, link it to any open
-- scope_coverage_gaps row that covers the same (customer, year,
-- jp_code). Doesn't auto-resolve the gap — that's a deliberate
-- manager decision after reviewing partial vs full coverage. Just
-- stamps "last delivered via check X on Y" so the register stays
-- live without manual touching.
--
-- Universal tier — fires for every tenant regardless of the
-- commercial-features flag. Cheap (one UPDATE per check completion)
-- and pure linkage; doesn't change behaviour beyond what auditors
-- can already see in audit_logs.
-- ============================================================

-- ── 1. Linkage column on scope_coverage_gaps ────────────────────────────

ALTER TABLE public.scope_coverage_gaps
  ADD COLUMN IF NOT EXISTS last_delivery_check_id uuid
    REFERENCES public.maintenance_checks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_delivery_at timestamptz;

CREATE INDEX IF NOT EXISTS scope_coverage_gaps_last_delivery_idx
  ON public.scope_coverage_gaps(last_delivery_check_id)
  WHERE last_delivery_check_id IS NOT NULL;

COMMENT ON COLUMN public.scope_coverage_gaps.last_delivery_check_id IS
  'The most-recent maintenance_check that covered this gap''s scope. Set by the on_check_complete_link_scope_gap trigger. Doesn''t auto-resolve the gap — the manager decides whether one delivered check closes the year''s commitment.';

-- ── 2. Trigger fn ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.link_completed_check_to_scope_gap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year integer;
  v_customer_id uuid;
  v_jp_code text;
BEGIN
  -- Only fire when status flips to 'completed' (or 'verified' if your
  -- workflow uses it). The WHEN clause on the trigger filters this; the
  -- function still guards in case the trigger gets re-bound to OR.
  IF NEW.status NOT IN ('completed', 'verified') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;  -- noop self-set
  END IF;

  -- Resolve the (customer, year, jp_code) tuple. Multi-plan checks
  -- (job_plan_id IS NULL with multiple plans in the items) don't link
  -- here — too ambiguous. Single-plan checks are the common case.
  IF NEW.job_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_year := COALESCE(
    EXTRACT(YEAR FROM NEW.completed_at)::integer,
    EXTRACT(YEAR FROM NEW.start_date)::integer,
    EXTRACT(YEAR FROM NEW.created_at)::integer
  );
  IF v_year IS NULL THEN RETURN NEW; END IF;

  SELECT customer_id INTO v_customer_id FROM public.sites WHERE id = NEW.site_id;
  IF v_customer_id IS NULL THEN RETURN NEW; END IF;

  SELECT code INTO v_jp_code FROM public.job_plans WHERE id = NEW.job_plan_id;

  -- Stamp every matching open gap. Same JP could have gaps in multiple
  -- years if work was carried over; only the target year's gap matches.
  UPDATE public.scope_coverage_gaps
     SET last_delivery_check_id = NEW.id,
         last_delivery_at       = COALESCE(NEW.completed_at, now())
   WHERE tenant_id = NEW.tenant_id
     AND customer_id = v_customer_id
     AND contract_year = v_year
     AND status = 'open'
     AND (
       jp_code = v_jp_code
       OR contract_scope_id IN (
         SELECT id FROM public.contract_scopes
          WHERE customer_id = v_customer_id
            AND financial_year IN (v_year::text, (v_year - 1) || '-' || v_year, v_year || '-' || (v_year + 1))
            AND (jp_code = v_jp_code OR job_plan_id = NEW.job_plan_id)
       )
     );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_completed_check_to_scope_gap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS maintenance_check_complete_links_gap ON public.maintenance_checks;
CREATE TRIGGER maintenance_check_complete_links_gap
  AFTER UPDATE OF status ON public.maintenance_checks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'verified'))
  EXECUTE FUNCTION public.link_completed_check_to_scope_gap();

COMMENT ON FUNCTION public.link_completed_check_to_scope_gap IS
  'Stamps last_delivery_check_id + last_delivery_at on any open scope_coverage_gaps row matching the completed check''s (customer, year, jp_code). Universal tier — fires for every tenant.';
