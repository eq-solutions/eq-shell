-- Migration 0070: Thermal scan schema (Phase 2 of Jemena report support).
--
-- Two new tables matching the data shape captured in Jemena's 2025 PDF
-- thermal scan reports (one per site visit). Source: 2026-04-27 report
-- study (Bathurst Thermal Report 2025).
--
--   thermal_scans            One per (site, visit). Header row with
--                            scope, equipment, evaluation mode, totals.
--   thermal_scan_findings    One per anomaly found during the scan.
--                            Pairs an IR image with a daylight image
--                            and a priority rating.
--
-- Locked decisions (chat 2026-04-27):
--   - evaluation_mode column with default 'qualitative' to match Jemena's
--     2025 standard. 'quantitative' supported when delta-T readings are entered.
--   - Per-finding priority_rating uses a controlled vocabulary; matches
--     Infraspection Institute / NETA classifications.
--   - IR + daylight image refs are FKs to attachments (existing storage
--     pipeline + RLS); not duplicated as columns on the findings table.

-- ============================================================
-- 1. thermal_scans
-- ============================================================

CREATE TABLE public.thermal_scans (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  customer_id             uuid                 REFERENCES public.customers(id) ON DELETE SET NULL,
  site_id                 uuid        NOT NULL REFERENCES public.sites(id)     ON DELETE CASCADE,
  check_id                uuid                 REFERENCES public.maintenance_checks(id) ON DELETE SET NULL,

  date_performed          date        NOT NULL,
  performed_by_user_id    uuid                 REFERENCES auth.users(id)       ON DELETE SET NULL,
  performed_by_snapshot   text,
  report_author           text,
  report_date             date,

  scope_of_survey         text,
  equipment_used          text,

  evaluation_mode         text        NOT NULL DEFAULT 'qualitative'
                                      CHECK (evaluation_mode IN ('qualitative','quantitative')),

  total_photos            integer     NOT NULL DEFAULT 0
                                      CHECK (total_photos >= 0),
  anomalies_found         integer     NOT NULL DEFAULT 0
                                      CHECK (anomalies_found >= 0),

  notes                   text,

  status                  text        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft','complete','archived')),

  is_active               boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX thermal_scans_tenant_idx        ON public.thermal_scans(tenant_id);
CREATE INDEX thermal_scans_site_date_idx     ON public.thermal_scans(site_id, date_performed DESC);
CREATE INDEX thermal_scans_check_idx         ON public.thermal_scans(check_id) WHERE check_id IS NOT NULL;
CREATE INDEX thermal_scans_customer_idx      ON public.thermal_scans(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON TABLE  public.thermal_scans IS
  'Header row per (site, visit) thermal scan. One thermal_scans row groups all thermal_scan_findings for that scan. Maps to one PDF deliverable per site per cycle.';
COMMENT ON COLUMN public.thermal_scans.scope_of_survey IS
  'Free text description of what was scanned (e.g. "All Distribution Boards").';
COMMENT ON COLUMN public.thermal_scans.equipment_used IS
  'Denormalised record of the IR camera used (e.g. "Fluke Ti110 14060422"). Free text — no equipment register linkage.';
COMMENT ON COLUMN public.thermal_scans.evaluation_mode IS
  'qualitative (Jemena 2025 standard) OR quantitative (delta-T thresholds applied). Default qualitative.';
COMMENT ON COLUMN public.thermal_scans.total_photos IS
  'Total IR + daylight photos taken during the scan.';

-- ============================================================
-- 2. thermal_scan_findings
-- ============================================================

CREATE TABLE public.thermal_scan_findings (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid        NOT NULL REFERENCES public.tenants(id)         ON DELETE CASCADE,
  thermal_scan_id               uuid        NOT NULL REFERENCES public.thermal_scans(id)   ON DELETE CASCADE,
  asset_id                      uuid                 REFERENCES public.assets(id)          ON DELETE SET NULL,

  ir_image_attachment_id        uuid                 REFERENCES public.attachments(id)     ON DELETE SET NULL,
  daylight_image_attachment_id  uuid                 REFERENCES public.attachments(id)     ON DELETE SET NULL,

  priority_rating               text        NOT NULL DEFAULT 'monitor'
                                            CHECK (priority_rating IN ('monitor','repair_when_practical','repair_soon','urgent','critical')),

  observation                   text,

  delta_temp_c                  numeric(6,2),
  ambient_temp_c                numeric(6,2),
  apparent_load_pct             integer
                                CHECK (apparent_load_pct IS NULL OR (apparent_load_pct BETWEEN 0 AND 200)),

  sort_order                    integer     NOT NULL DEFAULT 0,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX thermal_scan_findings_tenant_idx        ON public.thermal_scan_findings(tenant_id);
CREATE INDEX thermal_scan_findings_scan_idx          ON public.thermal_scan_findings(thermal_scan_id, sort_order);
CREATE INDEX thermal_scan_findings_asset_idx         ON public.thermal_scan_findings(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX thermal_scan_findings_priority_idx      ON public.thermal_scan_findings(tenant_id, priority_rating);

COMMENT ON TABLE  public.thermal_scan_findings IS
  'One row per anomaly detected during a thermal scan. Pairs an IR image with a daylight image and a priority rating.';
COMMENT ON COLUMN public.thermal_scan_findings.priority_rating IS
  'monitor | repair_when_practical | repair_soon | urgent | critical. Aligns with Infraspection Institute / NETA practice.';
COMMENT ON COLUMN public.thermal_scan_findings.delta_temp_c IS
  'Temperature differential in C above ambient or above adjacent phase. Quantitative mode only.';
COMMENT ON COLUMN public.thermal_scan_findings.ambient_temp_c IS
  'Recorded ambient temperature at the time of the finding. Quantitative mode only.';
COMMENT ON COLUMN public.thermal_scan_findings.apparent_load_pct IS
  'Estimated equipment load at the time of measurement. Quantitative mode only.';

-- ============================================================
-- 3. updated_at triggers
-- ============================================================

CREATE TRIGGER thermal_scans_set_updated_at
  BEFORE UPDATE ON public.thermal_scans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER thermal_scan_findings_set_updated_at
  BEFORE UPDATE ON public.thermal_scan_findings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. RLS — same pattern as rcd_tests / rcd_test_circuits (0069).
-- ============================================================

ALTER TABLE public.thermal_scans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thermal_scan_findings  ENABLE ROW LEVEL SECURITY;

-- ---------- thermal_scans ----------

CREATE POLICY thermal_scans_select ON public.thermal_scans
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY thermal_scans_insert ON public.thermal_scans
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  );

CREATE POLICY thermal_scans_update ON public.thermal_scans
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

CREATE POLICY thermal_scans_delete ON public.thermal_scans
  FOR DELETE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin')
  );

-- ---------- thermal_scan_findings ----------

CREATE POLICY thermal_scan_findings_select ON public.thermal_scan_findings
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY thermal_scan_findings_insert ON public.thermal_scan_findings
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id)
        IN ('super_admin','admin','supervisor','technician')
  );

CREATE POLICY thermal_scan_findings_update ON public.thermal_scan_findings
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

CREATE POLICY thermal_scan_findings_delete ON public.thermal_scan_findings
  FOR DELETE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin')
  );
