-- Migration 0002: Core schema — tenants, tenant_settings, tenant_members,
-- customers, sites, assets, job_plans, job_plan_items.
-- Expanded roles, RLS, triggers, helpers.
-- Rollback: drop all tables/functions created here in reverse order.

-- ============================================================
-- 1. TABLES (created before functions that reference them)
-- ============================================================

-- tenants
CREATE TABLE public.tenants (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        UNIQUE NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenants_slug_idx ON public.tenants (slug);
COMMENT ON TABLE public.tenants IS 'Root multi-tenant entity. Every data row belongs to a tenant.';

-- tenant_settings
CREATE TABLE public.tenant_settings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  primary_colour  text        NOT NULL DEFAULT '#3DA8D8',
  deep_colour     text        NOT NULL DEFAULT '#2986B4',
  ice_colour      text        NOT NULL DEFAULT '#EAF5FB',
  ink_colour      text        NOT NULL DEFAULT '#1A1A2E',
  logo_url        text,
  product_name    text        NOT NULL DEFAULT 'EQ Solves',
  support_email   text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_settings IS 'White-label settings per tenant: colours, logo, product name.';

-- tenant_members
CREATE TABLE public.tenant_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('super_admin','admin','supervisor','technician','read_only')),
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX tenant_members_user_idx   ON public.tenant_members (user_id);
CREATE INDEX tenant_members_tenant_idx ON public.tenant_members (tenant_id);
COMMENT ON TABLE public.tenant_members IS 'Links users to tenants with a per-tenant role.';

-- customers
CREATE TABLE public.customers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  code       text,
  email      text,
  phone      text,
  address    text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customers_tenant_idx ON public.customers (tenant_id);
COMMENT ON TABLE public.customers IS 'Client companies of a tenant (e.g., Equinix for SKS).';

-- sites
CREATE TABLE public.sites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  name        text        NOT NULL,
  code        text,
  address     text,
  city        text,
  state       text,
  postcode    text,
  country     text        NOT NULL DEFAULT 'Australia',
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sites_tenant_idx   ON public.sites (tenant_id);
CREATE INDEX sites_customer_idx ON public.sites (customer_id);
COMMENT ON TABLE public.sites IS 'Physical locations under a customer.';

-- assets
CREATE TABLE public.assets (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  site_id        uuid        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  asset_type     text        NOT NULL,
  manufacturer   text,
  model          text,
  serial_number  text,
  maximo_id      text,
  install_date   date,
  location       text,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assets_tenant_idx ON public.assets (tenant_id);
CREATE INDEX assets_site_idx   ON public.assets (site_id);
COMMENT ON TABLE public.assets IS 'Equipment at a site. asset_type: ACB, NSX, ATS, Switchboard, etc.';
COMMENT ON COLUMN public.assets.maximo_id IS 'Reference only — no live API sync to IBM Maximo.';

-- job_plans
CREATE TABLE public.job_plans (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  site_id     uuid        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  frequency   text        NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','biannual','annual','ad_hoc')),
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_plans_tenant_idx ON public.job_plans (tenant_id);
CREATE INDEX job_plans_site_idx   ON public.job_plans (site_id);
COMMENT ON TABLE public.job_plans IS 'Reusable maintenance plan templates linked to a site.';

-- job_plan_items
CREATE TABLE public.job_plan_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_plan_id uuid        NOT NULL REFERENCES public.job_plans(id) ON DELETE CASCADE,
  asset_id    uuid        REFERENCES public.assets(id) ON DELETE SET NULL,
  description text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_required boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_plan_items_plan_idx ON public.job_plan_items (job_plan_id);
COMMENT ON TABLE public.job_plan_items IS 'Individual task items within a job plan.';

-- ============================================================
-- 2. HELPER FUNCTIONS (after tables exist)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(tenant_id), '{}'::uuid[])
  FROM public.tenant_members
  WHERE user_id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid() AND role = 'super_admin' AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(p_tenant_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.tenant_members
  WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id
      AND role IN ('super_admin', 'admin') AND is_active = true
  );
$$;

-- ============================================================
-- 3. TRIGGERS (updated_at)
-- ============================================================

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tenant_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tenant_members_set_updated_at
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sites_set_updated_at
  BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER assets_set_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER job_plans_set_updated_at
  BEFORE UPDATE ON public.job_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER job_plan_items_set_updated_at
  BEFORE UPDATE ON public.job_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. EXPAND PROFILES ROLE CONSTRAINT
-- ============================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','admin','supervisor','technician','read_only','user'));

-- ============================================================
-- 5. RLS POLICIES
-- ============================================================

ALTER TABLE public.tenants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_plan_items    ENABLE ROW LEVEL SECURITY;

-- ---------- tenants ----------
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (id = ANY(public.get_user_tenant_ids()) OR public.is_super_admin());

CREATE POLICY tenants_insert ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY tenants_delete ON public.tenants
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ---------- tenant_settings ----------
CREATE POLICY tenant_settings_select ON public.tenant_settings
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()) OR public.is_super_admin());

CREATE POLICY tenant_settings_insert ON public.tenant_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY tenant_settings_update ON public.tenant_settings
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

-- ---------- tenant_members ----------
CREATE POLICY tenant_members_select ON public.tenant_members
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()) OR public.is_super_admin());

CREATE POLICY tenant_members_insert ON public.tenant_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY tenant_members_update ON public.tenant_members
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY tenant_members_delete ON public.tenant_members
  FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));

-- ---------- customers ----------
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY customers_delete ON public.customers
  FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));

-- ---------- sites ----------
CREATE POLICY sites_select ON public.sites
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY sites_insert ON public.sites
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY sites_update ON public.sites
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY sites_delete ON public.sites
  FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));

-- ---------- assets ----------
CREATE POLICY assets_select ON public.assets
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY assets_insert ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY assets_update ON public.assets
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY assets_delete ON public.assets
  FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));

-- ---------- job_plans ----------
CREATE POLICY job_plans_select ON public.job_plans
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY job_plans_insert ON public.job_plans
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY job_plans_update ON public.job_plans
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY job_plans_delete ON public.job_plans
  FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));

-- ---------- job_plan_items ----------
CREATE POLICY job_plan_items_select ON public.job_plan_items
  FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

CREATE POLICY job_plan_items_insert ON public.job_plan_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY job_plan_items_update ON public.job_plan_items
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY job_plan_items_delete ON public.job_plan_items
  FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));
