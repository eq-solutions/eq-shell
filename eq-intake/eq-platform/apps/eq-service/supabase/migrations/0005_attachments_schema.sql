-- ============================================================
-- Migration: attachments table + Supabase Storage bucket
-- Polymorphic attachments for any entity (maintenance_checks, test_records, assets, etc.)
-- ============================================================

-- 1. Create storage bucket for attachments (public for logo/branding access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Attachments metadata table
CREATE TABLE IF NOT EXISTS public.attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type   text NOT NULL,  -- 'maintenance_check', 'test_record', 'asset'
  entity_id     uuid NOT NULL,
  file_name     text NOT NULL,
  file_size     integer NOT NULL DEFAULT 0,
  content_type  text NOT NULL DEFAULT 'application/octet-stream',
  storage_path  text NOT NULL,  -- path within the 'attachments' bucket
  uploaded_by   uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_attachments_entity ON public.attachments(entity_type, entity_id);
CREATE INDEX idx_attachments_tenant ON public.attachments(tenant_id);

-- 3. RLS
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments_select" ON public.attachments
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "attachments_insert" ON public.attachments
  FOR INSERT WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin', 'supervisor')
  );

CREATE POLICY "attachments_delete" ON public.attachments
  FOR DELETE USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin', 'admin')
  );

-- 4. Storage policies
CREATE POLICY "storage_attachments_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids())
  );

CREATE POLICY "storage_attachments_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids())
  );

CREATE POLICY "storage_attachments_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids())
  );
