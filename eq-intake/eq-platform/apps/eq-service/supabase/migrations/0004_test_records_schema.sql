-- ============================================================
-- Migration 0004: Test Records (Sprint 8)
--
-- Generic per-asset test records + per-reading detail rows. Used for
-- routine periodic tests that don't fit the ACB/NSX 3-step workflow
-- (RCD, IR, earth-loop, thermography, etc).
--
-- ── 2026-05-15 BACKFILL NOTE ──
-- This file was originally a stub — the actual CREATE TABLE was applied
-- via the Supabase Management API (apply_migration call) during Sprint 8
-- and the SQL was never committed to the repo. Discovered 2026-05-15 when
-- the new integration-tests CI workflow ran `supabase start` against a
-- fresh database — migration 0010 (performance indexes) failed at line
-- `CREATE INDEX ... ON test_records ...` because the table didn't exist.
--
-- Recovered the DDL from prod via information_schema + pg_indexes +
-- pg_policies + pg_constraint, excluding columns/indexes/triggers that
-- were demonstrably added by LATER migrations (assigned_to in 0063, the
-- defect-trigger in 0062, the partial tenant_active index in 0010, the
-- FK-covering indexes in 0042). The result reflects what the schema
-- looked like at the END of Sprint 8 — what the never-committed SQL
-- should have said.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- test_records — one row per (asset, test_type, test_date)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.test_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  asset_id       uuid NOT NULL REFERENCES public.assets(id),
  site_id        uuid NOT NULL REFERENCES public.sites(id),
  test_type      text NOT NULL,
  test_date      date NOT NULL,
  tested_by      uuid REFERENCES auth.users(id),
  result         text NOT NULL DEFAULT 'pending'
                   CHECK (result IN ('pending', 'pass', 'fail', 'defect')),
  notes          text,
  next_test_due  date,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_records_tenant     ON public.test_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_test_records_asset      ON public.test_records(asset_id);
CREATE INDEX IF NOT EXISTS idx_test_records_site       ON public.test_records(site_id);
CREATE INDEX IF NOT EXISTS idx_test_records_result     ON public.test_records(result);
CREATE INDEX IF NOT EXISTS idx_test_records_test_date  ON public.test_records(test_date);
CREATE INDEX IF NOT EXISTS idx_test_records_tested_by  ON public.test_records(tested_by);
CREATE INDEX IF NOT EXISTS idx_test_records_next_due   ON public.test_records(next_test_due);

CREATE TRIGGER set_test_records_updated_at
  BEFORE UPDATE ON public.test_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.test_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view test records" ON public.test_records
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "Write roles can create test records" ON public.test_records
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = test_records.tenant_id
        AND tm.is_active = true
        AND tm.role IN ('super_admin', 'admin', 'supervisor')
    )
  );

CREATE POLICY "Write roles can update test records" ON public.test_records
  FOR UPDATE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = test_records.tenant_id
        AND tm.is_active = true
        AND tm.role IN ('super_admin', 'admin', 'supervisor')
    )
  );

CREATE POLICY "Admin can delete test records" ON public.test_records
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = test_records.tenant_id
        AND tm.is_active = true
        AND tm.role IN ('super_admin', 'admin')
    )
  );

-- ─────────────────────────────────────────────────────────────
-- test_record_readings — many rows per test_record (e.g. per-circuit timings)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.test_record_readings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
  test_record_id  uuid NOT NULL REFERENCES public.test_records(id) ON DELETE CASCADE,
  label           text NOT NULL,
  value           text,
  unit            text,
  pass            boolean,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_record_readings_record  ON public.test_record_readings(test_record_id);
CREATE INDEX IF NOT EXISTS idx_test_record_readings_tenant  ON public.test_record_readings(tenant_id);

CREATE TRIGGER set_test_record_readings_updated_at
  BEFORE UPDATE ON public.test_record_readings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.test_record_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view readings" ON public.test_record_readings
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "Write roles can create readings" ON public.test_record_readings
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = test_record_readings.tenant_id
        AND tm.is_active = true
        AND tm.role IN ('super_admin', 'admin', 'supervisor')
    )
  );

CREATE POLICY "Write roles can update readings" ON public.test_record_readings
  FOR UPDATE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = test_record_readings.tenant_id
        AND tm.is_active = true
        AND tm.role IN ('super_admin', 'admin', 'supervisor')
    )
  );

CREATE POLICY "Admin can delete readings" ON public.test_record_readings
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = test_record_readings.tenant_id
        AND tm.is_active = true
        AND tm.role IN ('super_admin', 'admin')
    )
  );
