-- ============================================================
-- Migration 0008: Audit Logs
-- Immutable append-only audit trail for all tenant actions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id),
  action      varchar(50) NOT NULL,          -- e.g. 'create', 'update', 'delete', 'login', 'export'
  entity_type varchar(50) NOT NULL,          -- e.g. 'asset', 'acb_test', 'nsx_test', 'maintenance_check'
  entity_id   uuid,                          -- nullable for non-entity actions like login
  summary     text,                          -- human-readable description
  metadata    jsonb DEFAULT '{}',            -- extra context (old/new values, IP, etc.)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON public.audit_logs(tenant_id);
CREATE INDEX idx_audit_user ON public.audit_logs(user_id);
CREATE INDEX idx_audit_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_action ON public.audit_logs(action);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);

-- RLS — read-only for tenant members, insert for supervisor+
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (tenant_id = ANY(public.get_user_tenant_ids()));

-- No update or delete policies — audit logs are immutable
