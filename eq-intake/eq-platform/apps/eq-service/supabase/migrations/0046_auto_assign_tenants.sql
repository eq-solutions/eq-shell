-- Migration: 0046_auto_assign_tenants
-- Purpose: Add default tenant assignment on signup, audit table for orphaned user assignments
-- Applied: 2026-04-18 via Supabase MCP from audit session
-- Rollback notes:
--   DROP TABLE public.orphaned_user_assignments CASCADE;
--   ALTER TABLE public.tenant_settings DROP COLUMN default_tenant_for_new_users;
--   (Restore prior handle_new_user() body from migration 0001 if needed.)

BEGIN;

-- ============================================================
-- 1. ADD SETTING COLUMN TO tenant_settings
-- ============================================================

ALTER TABLE public.tenant_settings
ADD COLUMN IF NOT EXISTS default_tenant_for_new_users uuid
  REFERENCES public.tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tenant_settings.default_tenant_for_new_users
IS 'If set, new signups are auto-assigned to this tenant with technician role. Null = no auto-assignment (current default behaviour).';

-- ============================================================
-- 2. CREATE AUDIT TABLE FOR MANUAL ASSIGNMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.orphaned_user_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  assigned_role      text NOT NULL DEFAULT 'technician'
    CHECK (assigned_role IN ('super_admin','admin','supervisor','technician','read_only')),
  assigned_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at        timestamptz NOT NULL DEFAULT now(),
  reason             text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orphaned_user_assignments_user_idx
  ON public.orphaned_user_assignments(user_id);

CREATE INDEX IF NOT EXISTS orphaned_user_assignments_tenant_idx
  ON public.orphaned_user_assignments(assigned_tenant_id);

CREATE INDEX IF NOT EXISTS orphaned_user_assignments_active_idx
  ON public.orphaned_user_assignments(is_active) WHERE is_active = true;

DROP TRIGGER IF EXISTS orphaned_user_assignments_set_updated_at
  ON public.orphaned_user_assignments;
CREATE TRIGGER orphaned_user_assignments_set_updated_at
  BEFORE UPDATE ON public.orphaned_user_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.orphaned_user_assignments
IS 'Audit trail of manual tenant assignments for previously orphaned users. Tracks who assigned which user to which tenant and why. Auto-assignments via the signup trigger do not create entries here.';

-- ============================================================
-- 3. RLS POLICIES FOR AUDIT TABLE
-- ============================================================

ALTER TABLE public.orphaned_user_assignments ENABLE ROW LEVEL SECURITY;

-- Visibility: the subject user, the assigner, super admins, or admins of the
-- target tenant can read assignment records.
DROP POLICY IF EXISTS orphaned_user_assignments_select ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_select
  ON public.orphaned_user_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR assigned_by = (SELECT auth.uid())
    OR (SELECT public.is_super_admin())
    OR assigned_tenant_id = ANY(public.get_user_tenant_ids())
  );

-- Insert: only admins of the target tenant or super admins. assigned_by must
-- be the acting user — prevents forging who made the assignment.
DROP POLICY IF EXISTS orphaned_user_assignments_insert ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_insert
  ON public.orphaned_user_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    assigned_by = (SELECT auth.uid())
    AND (
      (SELECT public.is_super_admin())
      OR public.get_user_role(assigned_tenant_id) IN ('admin','super_admin')
    )
  );

-- Update: only the original assigner or a super admin can edit. Typical use
-- is flipping is_active to false (soft delete) or correcting the reason.
DROP POLICY IF EXISTS orphaned_user_assignments_update ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_update
  ON public.orphaned_user_assignments
  FOR UPDATE TO authenticated
  USING (
    assigned_by = (SELECT auth.uid())
    OR (SELECT public.is_super_admin())
  )
  WITH CHECK (
    assigned_by = (SELECT auth.uid())
    OR (SELECT public.is_super_admin())
  );

-- No DELETE policy — soft delete via is_active = false is the only path
-- (per AGENTS.md: "Soft delete via `is_active = false`, never hard delete").

-- ============================================================
-- 4. UPDATE TRIGGER FUNCTION handle_new_user()
-- ============================================================
-- When a new auth.users row is created:
--   1. Create profiles row (existing behaviour preserved)
--   2. If default_tenant_for_new_users is configured in tenant_settings,
--      auto-create a tenant_members row (role = technician)
--   3. If not configured (null — current default), user remains unassigned and
--      hits the "no tenant assigned" screen in app/(app)/layout.tsx

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := 'user';
  v_admin_emails text[] := ARRAY['dev@eq.solutions'];
  v_default_tenant_id uuid;
BEGIN
  IF new.email = ANY(v_admin_emails) THEN
    v_role := 'admin';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    v_role,
    true
  );

  -- Pick the first tenant with a non-null default-tenant setting.
  -- Future iteration: context-aware (e.g., signup URL params, email domain match).
  SELECT ts.default_tenant_for_new_users
  INTO v_default_tenant_id
  FROM public.tenant_settings ts
  WHERE ts.default_tenant_for_new_users IS NOT NULL
  ORDER BY ts.created_at ASC
  LIMIT 1;

  IF v_default_tenant_id IS NOT NULL THEN
    INSERT INTO public.tenant_members (user_id, tenant_id, role, is_active)
    VALUES (new.id, v_default_tenant_id, 'technician', true)
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

COMMIT;

-- ============================================================
-- BACKFILL NOTES (Manual Step — Not in Migration)
-- ============================================================
-- After apply, identify orphaned users:
--
--   SELECT p.id, p.email, p.created_at
--   FROM public.profiles p
--   LEFT JOIN public.tenant_members tm ON p.id = tm.user_id AND tm.is_active = true
--   WHERE tm.id IS NULL
--   ORDER BY p.created_at DESC;
--
-- Admin UI at /admin/users (to be built, follow-up task) is the intended
-- backfill path. Each manual assignment should INSERT into tenant_members
-- AND into orphaned_user_assignments for the audit trail.
