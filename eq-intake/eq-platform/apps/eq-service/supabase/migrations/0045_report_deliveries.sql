-- ============================================================
-- Migration 0045: Report deliveries
--
-- Spine for the report delivery pipeline. Every per-check report
-- is generated in PDF + DOCX, stored in the attachments bucket,
-- and delivered via signed URL. This table is the single source
-- of truth for every report ever issued.
--
-- Design: docs/architecture/report-delivery.md
-- ============================================================

CREATE TABLE IF NOT EXISTS public.report_deliveries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id),
  customer_id           uuid NOT NULL REFERENCES public.customers(id),
  maintenance_check_id  uuid NOT NULL REFERENCES public.maintenance_checks(id),
  revision              smallint NOT NULL DEFAULT 1,

  -- Files (both formats generated together)
  pdf_file_path         text,
  docx_file_path        text,
  content_hash_sha256   text NOT NULL,

  -- Delivery record
  delivered_to          text[] NOT NULL,
  delivered_at          timestamptz NOT NULL DEFAULT now(),
  delivered_by          uuid NOT NULL REFERENCES auth.users(id),
  signed_url_expires_at timestamptz NOT NULL,
  delivery_message      text,

  -- Revision tracking
  revision_reason       text,

  -- Lifecycle
  download_count        integer NOT NULL DEFAULT 0,
  last_downloaded_at    timestamptz,
  revoked_at            timestamptz,
  revoked_by            uuid REFERENCES auth.users(id),
  revoke_reason         text,

  -- Bookkeeping
  mutation_id           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (maintenance_check_id, revision)
);

-- Indexes
CREATE INDEX idx_report_deliveries_tenant ON public.report_deliveries(tenant_id);
CREATE INDEX idx_report_deliveries_customer ON public.report_deliveries(customer_id);
CREATE INDEX idx_report_deliveries_mc ON public.report_deliveries(maintenance_check_id);

-- Trigger
CREATE TRIGGER set_report_deliveries_updated_at
  BEFORE UPDATE ON public.report_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.report_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read deliveries"
  ON public.report_deliveries FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "writers issue deliveries"
  ON public.report_deliveries FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor', 'technician')
  );

CREATE POLICY "supervisors revoke deliveries"
  ON public.report_deliveries FOR UPDATE TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()))
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );
