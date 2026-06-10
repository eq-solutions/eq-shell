-- 1. Assets: add job_plan_id FK and dark_site_test flag
ALTER TABLE assets ADD COLUMN IF NOT EXISTS job_plan_id uuid REFERENCES job_plans(id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS dark_site_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_assets_job_plan ON assets(job_plan_id);
CREATE INDEX IF NOT EXISTS idx_assets_tenant_site ON assets(tenant_id, site_id);

-- 2. Maintenance checks: add frequency, dark site, custom name, start date, maximo refs
ALTER TABLE maintenance_checks ADD COLUMN IF NOT EXISTS frequency text;
ALTER TABLE maintenance_checks ADD COLUMN IF NOT EXISTS is_dark_site boolean NOT NULL DEFAULT false;
ALTER TABLE maintenance_checks ADD COLUMN IF NOT EXISTS custom_name text;
ALTER TABLE maintenance_checks ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE maintenance_checks ADD COLUMN IF NOT EXISTS maximo_wo_number text;
ALTER TABLE maintenance_checks ADD COLUMN IF NOT EXISTS maximo_pm_number text;
ALTER TABLE maintenance_checks ALTER COLUMN job_plan_id DROP NOT NULL;

-- 3. New check_assets junction table
CREATE TABLE IF NOT EXISTS check_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  check_id uuid NOT NULL REFERENCES maintenance_checks(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id),
  status text NOT NULL DEFAULT 'pending',
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(check_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_check_assets_check ON check_assets(check_id);
CREATE INDEX IF NOT EXISTS idx_check_assets_asset ON check_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_check_assets_tenant ON check_assets(tenant_id);

-- RLS for check_assets
ALTER TABLE check_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view check_assets"
  ON check_assets FOR SELECT
  USING (tenant_id = ANY (get_user_tenant_ids()));

CREATE POLICY "Admin and supervisor can create check_assets"
  ON check_assets FOR INSERT
  WITH CHECK (tenant_id = ANY (get_user_tenant_ids()));

CREATE POLICY "Write roles can update check_assets"
  ON check_assets FOR UPDATE
  USING (tenant_id = ANY (get_user_tenant_ids()));

CREATE POLICY "Admin can delete check_assets"
  ON check_assets FOR DELETE
  USING (
    (tenant_id = ANY (get_user_tenant_ids()))
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE tenant_members.user_id = auth.uid()
        AND tenant_members.tenant_id = check_assets.tenant_id
        AND tenant_members.is_active = true
        AND tenant_members.role IN ('super_admin', 'admin')
    )
  );

-- 4. Add check_asset_id to maintenance_check_items
ALTER TABLE maintenance_check_items ADD COLUMN IF NOT EXISTS check_asset_id uuid REFERENCES check_assets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_check_items_check_asset ON maintenance_check_items(check_asset_id);
