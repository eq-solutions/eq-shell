-- ============================================================
-- Migration 0027: Security & performance cleanup
--
-- Addresses Supabase advisor findings (run 2026-04-11):
--   1. auth_rls_initplan (24) — wrap auth.uid() and
--      get_user_tenant_ids() calls in (select …) so the planner
--      evaluates them once per query instead of once per row.
--   2. multiple_permissive_policies — consolidate profiles SELECT
--      and UPDATE; split "Writers can manage" on customer_contacts
--      and site_contacts so SELECT is handled by a single policy.
--   3. duplicate_index — drop the older idx_checks_* duplicates on
--      maintenance_checks, keep the idx_maintenance_checks_* names.
--
-- All policy recreations preserve existing behaviour — this is a
-- pure refactor for planner performance and tidy policy sets.
-- ============================================================

-- ============================================================
-- 1. profiles — consolidate admin/own SELECT + UPDATE into
--    single policies and wrap helper calls.
-- ============================================================
DROP POLICY IF EXISTS profiles_select_own   ON public.profiles;
DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own   ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (select auth.uid())
    OR (select public.is_admin())
  );

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = (select auth.uid())
    OR (select public.is_admin())
  )
  WITH CHECK (
    (select public.is_admin())
    OR (
      id = (select auth.uid())
      AND role = (SELECT p.role FROM public.profiles p WHERE p.id = (select auth.uid()))
    )
  );

-- ============================================================
-- 2. mfa_recovery_codes
-- ============================================================
DROP POLICY IF EXISTS mfa_recovery_codes_select_own ON public.mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_select_own ON public.mfa_recovery_codes
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================
-- 3. notifications
-- ============================================================
DROP POLICY IF EXISTS "Users see own notifications"    ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;

CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT
  USING (user_id = (select auth.uid()));

CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ============================================================
-- 4. maintenance_checks
-- ============================================================
DROP POLICY IF EXISTS "Admin and supervisor can create checks"                 ON public.maintenance_checks;
DROP POLICY IF EXISTS "Write roles and assigned technicians can update checks" ON public.maintenance_checks;
DROP POLICY IF EXISTS "Admin can delete checks"                                ON public.maintenance_checks;

CREATE POLICY "Admin and supervisor can create checks" ON public.maintenance_checks
  FOR INSERT
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = maintenance_checks.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Write roles and assigned technicians can update checks" ON public.maintenance_checks
  FOR UPDATE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = (select auth.uid())
          AND tm.tenant_id = maintenance_checks.tenant_id
          AND tm.is_active = true
          AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
      )
      OR assigned_to = (select auth.uid())
    )
  );

CREATE POLICY "Admin can delete checks" ON public.maintenance_checks
  FOR DELETE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = maintenance_checks.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text])
    )
  );

-- ============================================================
-- 5. maintenance_check_items
-- ============================================================
DROP POLICY IF EXISTS "Admin and supervisor can create check items"                 ON public.maintenance_check_items;
DROP POLICY IF EXISTS "Write roles and assigned technicians can update check items" ON public.maintenance_check_items;
DROP POLICY IF EXISTS "Admin can delete check items"                                ON public.maintenance_check_items;

CREATE POLICY "Admin and supervisor can create check items" ON public.maintenance_check_items
  FOR INSERT
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = maintenance_check_items.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Write roles and assigned technicians can update check items" ON public.maintenance_check_items
  FOR UPDATE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = (select auth.uid())
          AND tm.tenant_id = maintenance_check_items.tenant_id
          AND tm.is_active = true
          AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
      )
      OR EXISTS (
        SELECT 1 FROM public.maintenance_checks mc
        WHERE mc.id = maintenance_check_items.check_id
          AND mc.assigned_to = (select auth.uid())
      )
    )
  );

CREATE POLICY "Admin can delete check items" ON public.maintenance_check_items
  FOR DELETE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = maintenance_check_items.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text])
    )
  );

-- ============================================================
-- 6. test_records
-- ============================================================
DROP POLICY IF EXISTS "Write roles can create test records" ON public.test_records;
DROP POLICY IF EXISTS "Write roles can update test records" ON public.test_records;
DROP POLICY IF EXISTS "Admin can delete test records"       ON public.test_records;

CREATE POLICY "Write roles can create test records" ON public.test_records
  FOR INSERT
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = test_records.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Write roles can update test records" ON public.test_records
  FOR UPDATE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = test_records.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Admin can delete test records" ON public.test_records
  FOR DELETE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = test_records.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text])
    )
  );

-- ============================================================
-- 7. test_record_readings
-- ============================================================
DROP POLICY IF EXISTS "Write roles can create readings" ON public.test_record_readings;
DROP POLICY IF EXISTS "Write roles can update readings" ON public.test_record_readings;
DROP POLICY IF EXISTS "Admin can delete readings"       ON public.test_record_readings;

CREATE POLICY "Write roles can create readings" ON public.test_record_readings
  FOR INSERT
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = test_record_readings.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Write roles can update readings" ON public.test_record_readings
  FOR UPDATE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = test_record_readings.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Admin can delete readings" ON public.test_record_readings
  FOR DELETE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = test_record_readings.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text])
    )
  );

-- ============================================================
-- 8. check_assets
-- ============================================================
DROP POLICY IF EXISTS "Admin can delete check_assets" ON public.check_assets;
CREATE POLICY "Admin can delete check_assets" ON public.check_assets
  FOR DELETE
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.tenant_id = check_assets.tenant_id
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text])
    )
  );

-- ============================================================
-- 9. contract_scopes — tenant isolation
-- ============================================================
DROP POLICY IF EXISTS "Tenant isolation" ON public.contract_scopes;
CREATE POLICY "Tenant isolation" ON public.contract_scopes
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid()) AND tm.is_active = true
    )
  );

-- ============================================================
-- 10. defects — tenant isolation
-- ============================================================
DROP POLICY IF EXISTS "Tenant isolation" ON public.defects;
CREATE POLICY "Tenant isolation" ON public.defects
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid()) AND tm.is_active = true
    )
  );

-- ============================================================
-- 11. site_contacts — split "Writers can manage" into
--     INSERT/UPDATE/DELETE so the SELECT path is handled
--     exclusively by "Tenant members can read site contacts".
-- ============================================================
DROP POLICY IF EXISTS "Tenant members can read site contacts" ON public.site_contacts;
DROP POLICY IF EXISTS "Writers can manage site contacts"      ON public.site_contacts;

CREATE POLICY "Tenant members can read site contacts" ON public.site_contacts
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid()) AND tm.is_active = true
    )
  );

CREATE POLICY "Writers can insert site contacts" ON public.site_contacts
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Writers can update site contacts" ON public.site_contacts
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Writers can delete site contacts" ON public.site_contacts
  FOR DELETE
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

-- ============================================================
-- 12. customer_contacts — same split pattern as site_contacts
-- ============================================================
DROP POLICY IF EXISTS "Tenant members can read customer contacts" ON public.customer_contacts;
DROP POLICY IF EXISTS "Writers can manage customer contacts"      ON public.customer_contacts;

CREATE POLICY "Tenant members can read customer contacts" ON public.customer_contacts
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid()) AND tm.is_active = true
    )
  );

CREATE POLICY "Writers can insert customer contacts" ON public.customer_contacts
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Writers can update customer contacts" ON public.customer_contacts
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

CREATE POLICY "Writers can delete customer contacts" ON public.customer_contacts
  FOR DELETE
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (select auth.uid())
        AND tm.is_active = true
        AND tm.role = ANY (ARRAY['super_admin'::text,'admin'::text,'supervisor'::text])
    )
  );

-- ============================================================
-- 13. Drop duplicate indexes on maintenance_checks.
--     Keep the idx_maintenance_checks_* names (more canonical).
-- ============================================================
DROP INDEX IF EXISTS public.idx_checks_due_date;
DROP INDEX IF EXISTS public.idx_checks_status;
