-- Migration: 0036_migration_counts_rpc
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Per-tenant row counts for EVERY migrated app_data table, for the
--            admin/migration reconciliation view (expected-vs-landed).
--
-- Unlike eq_tenant_dashboard_counts (a fixed 9-entity dashboard subset), this
-- counts every app_data BASE TABLE that carries a tenant_id column, so the
-- reconciliation view covers the full migrated surface without a hardcoded
-- list — robust to per-tenant schema drift (tenants diverge; see CLAUDE.md).
--
-- `entity` is the app_data table name (e.g. 'customers', 'staff'); the
-- reconcile function keys baseline + landed on the same value.
--
-- NOT YET APPLIED — author-on-branch. Apply to each tenant DB via Supabase MCP
-- when ready (same rollout as the other tenant-migrations/*.sql).

CREATE OR REPLACE FUNCTION public.eq_migration_counts(p_tenant_id uuid)
RETURNS TABLE(entity text, landed_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name   = c.table_name
    WHERE c.table_schema = 'app_data'
      AND c.column_name  = 'tenant_id'
      AND t.table_type   = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    -- %I quotes the identifier; the value is bound as a parameter — injection-safe.
    EXECUTE format('SELECT count(*) FROM app_data.%I WHERE tenant_id = $1', r.table_name)
      INTO n USING p_tenant_id;
    entity       := r.table_name;
    landed_count := n;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Service-role only — called by the migration-reconcile Netlify function,
-- which carries no JWT (matches eq_tenant_dashboard_counts grants).
REVOKE ALL ON FUNCTION public.eq_migration_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_migration_counts(uuid) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0036_migration_counts_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
