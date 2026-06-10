-- Customer contacts table (multiple contacts per customer, one primary)
CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text DEFAULT NULL,
  email text DEFAULT NULL,
  phone text DEFAULT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read customer contacts"
  ON public.customer_contacts FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY "Writers can manage customer contacts"
  ON public.customer_contacts FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND is_active = true AND role IN ('super_admin', 'admin', 'supervisor')))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND is_active = true AND role IN ('super_admin', 'admin', 'supervisor')));

-- Trigger for updated_at
CREATE TRIGGER set_customer_contacts_updated_at
  BEFORE UPDATE ON public.customer_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Ensure only one primary per customer
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_contacts_primary
  ON public.customer_contacts (customer_id)
  WHERE is_primary = true;
