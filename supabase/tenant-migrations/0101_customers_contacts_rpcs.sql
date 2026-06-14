-- Migration 0101: Customers + Contacts RPCs for EQ Ops
--
-- 1. Fix eq_list_config_audit — wrong JWT path (was top-level, needs app_metadata)
-- 2. eq_list_customers_with_stats  — customer list with quote count + total value
-- 3. eq_list_contacts_for_customer — contacts for a given customer
-- 4. eq_list_quotes_for_customer   — quote list for a given customer (for drill-down)

-- ============================================================================
-- 1. Fix eq_list_config_audit JWT path
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_config_audit(p_limit INT DEFAULT 50)
RETURNS TABLE(
  audit_id      UUID,
  entity_type   TEXT,
  entity_id     TEXT,
  action        TEXT,
  label         TEXT,
  changes       JSONB,
  actor_initials TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id UUID := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    ca.audit_id,
    ca.entity_type,
    ca.entity_id,
    ca.action,
    ca.label,
    ca.changes,
    ca.actor_initials,
    ca.created_at
  FROM app_data.config_audit ca
  WHERE ca.tenant_id = v_tenant_id
  ORDER BY ca.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_config_audit(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_config_audit(INT) TO authenticated;

-- ============================================================================
-- 2. eq_list_customers_with_stats
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_customers_with_stats()
RETURNS TABLE(
  customer_id    UUID,
  company_name   TEXT,
  email          TEXT,
  primary_phone  TEXT,
  suburb         TEXT,
  state          TEXT,
  active         BOOLEAN,
  quote_count    BIGINT,
  total_cents    BIGINT,
  last_quote_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id UUID := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    cu.customer_id,
    cu.company_name::text,
    cu.email::text,
    cu.primary_phone::text,
    cu.suburb::text,
    cu.state::text,
    COALESCE(cu.active, true),
    COUNT(q.quote_id)::bigint,
    COALESCE(SUM(q.total_cents), 0)::bigint,
    MAX(q.created_at)
  FROM app_data.customers cu
  LEFT JOIN app_data.quote q
    ON q.customer_id = cu.customer_id
   AND q.tenant_id   = v_tenant_id
   AND q.deleted_at  IS NULL
  WHERE cu.tenant_id = v_tenant_id
  GROUP BY
    cu.customer_id, cu.company_name, cu.email,
    cu.primary_phone, cu.suburb, cu.state, cu.active
  ORDER BY cu.company_name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_customers_with_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_customers_with_stats() TO authenticated;

-- ============================================================================
-- 3. eq_list_contacts_for_customer
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_contacts_for_customer(p_customer_id UUID)
RETURNS TABLE(
  contact_id               UUID,
  first_name               TEXT,
  last_name                TEXT,
  email                    TEXT,
  work_phone               TEXT,
  mobile_phone             TEXT,
  contact_position         TEXT,
  is_default_quote_contact BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id UUID := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    co.contact_id,
    co.first_name::text,
    co.last_name::text,
    co.email::text,
    co.work_phone::text,
    co.mobile_phone::text,
    co."position"::text,
    COALESCE(co.is_default_quote_contact, false)
  FROM app_data.contacts co
  WHERE co.customer_id = p_customer_id
    AND co.tenant_id   = v_tenant_id
    AND COALESCE(co.active, true) = true
  ORDER BY co.is_default_quote_contact DESC NULLS LAST,
           co.last_name, co.first_name;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_contacts_for_customer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_contacts_for_customer(UUID) TO authenticated;

-- ============================================================================
-- 4. eq_list_quotes_for_customer
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eq_list_quotes_for_customer(p_customer_id UUID)
RETURNS TABLE(
  quote_id       UUID,
  quote_number   TEXT,
  status         TEXT,
  project_name   TEXT,
  total_cents    BIGINT,
  estimator_initials TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE
  v_tenant_id UUID := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    q.quote_id,
    q.quote_number::text,
    q.status::text,
    q.project_name::text,
    q.total_cents,
    q.estimator_initials::text,
    q.sent_at,
    q.created_at
  FROM app_data.quote q
  WHERE q.customer_id = p_customer_id
    AND q.tenant_id   = v_tenant_id
    AND q.deleted_at  IS NULL
  ORDER BY q.created_at DESC
  LIMIT 25;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_list_quotes_for_customer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eq_list_quotes_for_customer(UUID) TO authenticated;
