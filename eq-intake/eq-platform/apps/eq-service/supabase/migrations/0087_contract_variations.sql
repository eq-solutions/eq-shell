-- ============================================================
-- Migration 0087: Phase 4 of the contract-scope ↔ check bridge — the
-- variations register.
--
-- Out-of-scope work doesn't disappear when the operator overrides the
-- Phase 3 gate; it gets captured as a variation against the customer's
-- contract. This table is the canonical record:
--
--   draft  → quoted  → approved → billed
--          ↘ rejected
--          ↘ cancelled (any state)
--
-- Each variation links to (a) the customer + optional site, (b) optionally
-- the contract_scopes row it deviates from, (c) optionally the source
-- maintenance_check that triggered it. The financial_year mirrors the
-- contract_scopes vocabulary so reporting can join cleanly.
--
-- Commercial tier — the register page is gated on
-- tenant_settings.commercial_features_enabled. The table itself is universal
-- so legacy data isn't lost if a tenant flips the flag off and on.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contract_variations (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id        uuid          NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_id            uuid          REFERENCES public.sites(id) ON DELETE SET NULL,
  contract_scope_id  uuid          REFERENCES public.contract_scopes(id) ON DELETE SET NULL,

  -- Human-readable variation reference (e.g. CV-2026-0001). Operators can
  -- override; uniqueness is enforced per tenant.
  variation_number   text          NOT NULL,
  title              text          NOT NULL,
  description        text,
  financial_year     text,

  -- Money. value_estimate is what we think it'll cost; value_approved is
  -- what the customer signed off on (often after negotiation). Both
  -- nullable — drafts may not have figures yet.
  value_estimate     numeric(12,2),
  value_approved     numeric(12,2),

  status             text          NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'quoted', 'approved', 'rejected', 'billed', 'cancelled')),

  -- Customer-side identifiers (their PO #, their variation reference, etc.)
  customer_ref       text,

  -- Source maintenance_check that triggered the variation. Soft FK — the
  -- variation survives if the check is later archived.
  source_check_id    uuid          REFERENCES public.maintenance_checks(id) ON DELETE SET NULL,

  -- Lifecycle timestamps. Set automatically by the status-transition
  -- server action; not enforced at the DB layer (managers occasionally
  -- back-date for audit reasons).
  approved_at        timestamptz,
  rejected_at        timestamptz,
  billed_at          timestamptz,

  notes              text,

  created_by         uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, variation_number)
);

-- Updated-at trigger reuses the universal helper.
DROP TRIGGER IF EXISTS contract_variations_updated_at ON public.contract_variations;
CREATE TRIGGER contract_variations_updated_at
  BEFORE UPDATE ON public.contract_variations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS contract_variations_tenant_idx
  ON public.contract_variations(tenant_id);
CREATE INDEX IF NOT EXISTS contract_variations_customer_idx
  ON public.contract_variations(customer_id, financial_year);
CREATE INDEX IF NOT EXISTS contract_variations_status_idx
  ON public.contract_variations(tenant_id, status)
  WHERE status NOT IN ('billed', 'cancelled');
CREATE INDEX IF NOT EXISTS contract_variations_scope_idx
  ON public.contract_variations(contract_scope_id)
  WHERE contract_scope_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_variations_source_check_idx
  ON public.contract_variations(source_check_id)
  WHERE source_check_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.contract_variations ENABLE ROW LEVEL SECURITY;

-- Read: any tenant member.
CREATE POLICY contract_variations_select ON public.contract_variations
  FOR SELECT USING (
    tenant_id = ANY (public.get_user_tenant_ids())
  );

-- Write: writer role or above. canWrite() in app-layer mirrors this.
CREATE POLICY contract_variations_insert ON public.contract_variations
  FOR INSERT WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor', 'technician')
  );

CREATE POLICY contract_variations_update ON public.contract_variations
  FOR UPDATE USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor', 'technician')
  );

-- Delete: admin only — variations are commercial records.
CREATE POLICY contract_variations_delete ON public.contract_variations
  FOR DELETE USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

COMMENT ON TABLE public.contract_variations IS
  'Variations register — out-of-scope work captured as a billable deviation from contract_scopes. Phase 4 of the contract-scope bridge plan; surfaces in the /variations register for tenants on the commercial tier (tenant_settings.commercial_features_enabled).';

COMMENT ON COLUMN public.contract_variations.status IS
  'Lifecycle: draft (under construction) → quoted (sent to customer) → approved/rejected → billed. cancelled is terminal from any state.';

-- ── Sequence helper for default variation_number ────────────────────────
--
-- Generates 'CV-YYYY-NNNN' per tenant per year. Not strictly enforced —
-- operators can override the variation_number at creation time — but useful
-- as a default when the form leaves it blank.

CREATE OR REPLACE FUNCTION public.next_variation_number(p_tenant_id uuid, p_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max integer;
  v_year_str text := p_year::text;
BEGIN
  -- Look at existing CV-YYYY-NNNN numbers for this tenant + year, find max,
  -- bump by 1. Falls back to 0001 if none yet. substring(x from 'pattern')
  -- returns the first capture group, or NULL on no match.
  SELECT COALESCE(MAX(
    (substring(variation_number from ('^CV-' || v_year_str || '-(\d{4})$')))::integer
  ), 0) + 1
    INTO v_max
    FROM public.contract_variations
   WHERE tenant_id = p_tenant_id
     AND variation_number ~ ('^CV-' || v_year_str || '-\d{4}$');

  RETURN 'CV-' || v_year_str || '-' || lpad(v_max::text, 4, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_variation_number(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_variation_number(uuid, integer) TO authenticated;
