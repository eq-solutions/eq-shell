-- Migration 0069: RCD test schema (Phase 1 of Jemena RCD workflow).
--
-- Two new tables matching the data shape captured in Jemena's 2025
-- multi-tab .xlsx RCD reports (one tab per board, per-circuit timing):
--
--   rcd_tests          — header per (board, visit) — site, asset, tech,
--                        sign-off, status
--   rcd_test_circuits  — one row per RCD circuit on the board with all
--                        timing values, button check, action taken
--
-- Locked decisions (chat 2026-04-27):
--   - Per-circuit Jemena asset IDs stored as text on rcd_test_circuits
--     (sub-asset semantics, not promoted to first-class assets rows).
--   - Timing values stored as text to allow "" string values that
--     Jemena's existing template uses for "no trip" cases.
--   - is_critical_load boolean on circuits (ESS / UPS feeders that
--     must NOT be tripped — surfaces a guard in the wizard later).
--
-- Source: Jemena report study 2026-04-27 + earlier Phase 1 spec
-- (see project_multi_file_import_phase2.md and chat for the audit).

-- ============================================================
-- 1. rcd_tests
-- ============================================================

CREATE TABLE public.rcd_tests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  customer_id                 uuid                 REFERENCES public.customers(id) ON DELETE SET NULL,
  site_id                     uuid        NOT NULL REFERENCES public.sites(id)     ON DELETE CASCADE,
  asset_id                    uuid        NOT NULL REFERENCES public.assets(id)    ON DELETE CASCADE,
  check_id                    uuid                 REFERENCES public.maintenance_checks(id) ON DELETE SET NULL,

  test_date                   date        NOT NULL,
  technician_user_id          uuid                 REFERENCES auth.users(id)       ON DELETE SET NULL,
  technician_name_snapshot    text,
  technician_initials         text,
  site_signature_url          text,
  site_rep_name               text,
  equipment_used              text,
  notes                       text,

  status                      text        NOT NULL DEFAULT 'draft'
                                          CHECK (status IN ('draft','complete','archived')),

  is_active                   boolean     NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rcd_tests_tenant_idx        ON public.rcd_tests(tenant_id);
CREATE INDEX rcd_tests_site_idx          ON public.rcd_tests(site_id);
CREATE INDEX rcd_tests_asset_date_idx    ON public.rcd_tests(asset_id, test_date DESC);
CREATE INDEX rcd_tests_check_idx         ON public.rcd_tests(check_id) WHERE check_id IS NOT NULL;
CREATE INDEX rcd_tests_customer_idx      ON public.rcd_tests(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON TABLE  public.rcd_tests IS
  'Header row per (board asset, visit). One rcd_tests row groups all rcd_test_circuits for that board on that day. Maps to one tab in the Jemena multi-tab xlsx deliverable.';
COMMENT ON COLUMN public.rcd_tests.check_id IS
  'Optional link to the parent maintenance_checks row (the 6-monthly visit). Null for ad-hoc tests outside the regular cycle.';
COMMENT ON COLUMN public.rcd_tests.technician_name_snapshot IS
  'Snapshot of technician name at test time, in case the user record is later removed or renamed.';
COMMENT ON COLUMN public.rcd_tests.technician_initials IS
  'Short initials (e.g. "AH") rendered inline on the per-row signature column of the xlsx report.';
COMMENT ON COLUMN public.rcd_tests.equipment_used IS
  'Free-text record of the test instrument used (e.g. "Fluke 1654B Tester #1234"). Optional; some reports include it.';

-- ============================================================
-- 2. rcd_test_circuits
-- ============================================================

CREATE TABLE public.rcd_test_circuits (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  rcd_test_id                 uuid        NOT NULL REFERENCES public.rcd_tests(id) ON DELETE CASCADE,

  -- Section grouping within a board (some boards split "Lighting Section"
  -- vs "Power Section"). NULL when the board is unsectioned.
  section_label               text,

  -- Circuit identifier as labelled on the board (e.g. "1", "3a", "L1-7").
  circuit_no                  text        NOT NULL,

  -- Trip current rating in mA. Default 30 matches Jemena's standard.
  normal_trip_current_ma      integer     NOT NULL DEFAULT 30
                                          CHECK (normal_trip_current_ma > 0),

  -- Timing fields stored as text to allow the "" non-trip indicator
  -- that Jemena's xlsx template uses. Numeric coercion happens at the
  -- report-rendering / pass-fail step, not at storage.
  x1_no_trip_0_ms             text,
  x1_no_trip_180_ms           text,
  x1_trip_0_ms                text,
  x1_trip_180_ms              text,
  x5_fast_0_ms                text,
  x5_fast_180_ms              text,

  trip_test_button_ok         boolean     NOT NULL DEFAULT false,

  -- Per-circuit Jemena asset ID (e.g. "30248"). Sub-asset semantics —
  -- not a foreign key into assets, just a text marker for Jemena
  -- traceability. Promote to first-class asset rows later if cross-
  -- cycle tracking proves needed.
  jemena_circuit_asset_id     text,

  -- Free-text: e.g. "N/A", "Critical Equipment — do not trip", or
  -- a description of corrective action taken on a fail.
  action_taken                text,

  -- Critical-load flag — UI surfaces a guard so the technician doesn't
  -- accidentally trip a UPS / ESS feeder. Defaults false; enabled per-
  -- circuit when a previous test or the asset register marks it critical.
  is_critical_load            boolean     NOT NULL DEFAULT false,

  sort_order                  integer     NOT NULL DEFAULT 0,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (rcd_test_id, circuit_no)
);

CREATE INDEX rcd_test_circuits_tenant_idx  ON public.rcd_test_circuits(tenant_id);
CREATE INDEX rcd_test_circuits_test_idx    ON public.rcd_test_circuits(rcd_test_id, sort_order);
CREATE INDEX rcd_test_circuits_jemena_idx
  ON public.rcd_test_circuits(tenant_id, jemena_circuit_asset_id)
  WHERE jemena_circuit_asset_id IS NOT NULL;

COMMENT ON TABLE  public.rcd_test_circuits IS
  'One row per RCD circuit tested. Belongs to an rcd_tests parent (the board+visit). Renders as one row in the Jemena xlsx deliverable.';
COMMENT ON COLUMN public.rcd_test_circuits.section_label IS
  'Optional sub-section within a board (e.g. "Lighting Section" / "Power Section"). NULL when the board is not sub-sectioned.';
COMMENT ON COLUMN public.rcd_test_circuits.circuit_no IS
  'Circuit identifier as labelled on the board. Stored as text to support non-numeric labels like "3a" or "L1-7".';
COMMENT ON COLUMN public.rcd_test_circuits.jemena_circuit_asset_id IS
  'Per-circuit Jemena asset ID (e.g. "30248"). Sub-asset semantics — text marker only, not a FK into assets.';
COMMENT ON COLUMN public.rcd_test_circuits.is_critical_load IS
  'When true, the wizard surfaces a guard before allowing the technician to enter trip values (prevents accidentally tripping a UPS / ESS feeder).';

-- ============================================================
-- 3. updated_at triggers
-- ============================================================

CREATE TRIGGER rcd_tests_set_updated_at
  BEFORE UPDATE ON public.rcd_tests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER rcd_test_circuits_set_updated_at
  BEFORE UPDATE ON public.rcd_test_circuits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. RLS — tenant-scoped read; writer role for mutations.
--
-- Pattern matches existing tables (acb_tests, nsx_tests). Helper
-- calls wrapped in (select ...) per AGENTS.md performance guidance.
-- ============================================================

ALTER TABLE public.rcd_tests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rcd_test_circuits  ENABLE ROW LEVEL SECURITY;

-- ---------- rcd_tests ----------

CREATE POLICY rcd_tests_select ON public.rcd_tests
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY rcd_tests_insert ON public.rcd_tests
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  );

CREATE POLICY rcd_tests_update ON public.rcd_tests
  FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  )
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  );

CREATE POLICY rcd_tests_delete ON public.rcd_tests
  FOR DELETE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin')
  );

-- ---------- rcd_test_circuits ----------

CREATE POLICY rcd_test_circuits_select ON public.rcd_test_circuits
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY rcd_test_circuits_insert ON public.rcd_test_circuits
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  );

CREATE POLICY rcd_test_circuits_update ON public.rcd_test_circuits
  FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  )
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  );

CREATE POLICY rcd_test_circuits_delete ON public.rcd_test_circuits
  FOR DELETE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin')
  );
