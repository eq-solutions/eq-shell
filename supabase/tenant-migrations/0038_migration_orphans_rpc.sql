-- Migration: 0038_migration_orphans_rpc
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Referential-integrity scan for the admin/migration reconciliation
--            view. For every enforced FK within app_data, counts child rows
--            whose FK value has no matching parent — the silent failure a
--            count-match can't catch (a row that landed but lost its link).
--
-- Why this matters: bulk migrations commonly load with FK triggers disabled
-- (session_replication_role='replica') to avoid insert-ordering pain, so
-- orphans CAN slip past the enforced constraints during the load. This is the
-- post-load net that catches them.
--
-- Scope: single-column FKs only. Verified against the live SKS tenant
-- (ehowgjardagevnrluult, 2026-06-06): 69 FK constraints, 0 composite, all
-- validated — so single-column covers 100% today. Composite FKs (if ever added)
-- are skipped, not mis-counted.
--
-- NOT YET APPLIED — author-on-branch. Apply to each target tenant DB via
-- Supabase MCP when ready.

CREATE OR REPLACE FUNCTION public.eq_migration_orphans(p_tenant_id uuid)
RETURNS TABLE(child_table text, fk_name text, parent_table text, orphan_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'app_data', 'public', 'extensions'
AS $$
DECLARE
  r record;
  n bigint;
  has_tenant boolean;
BEGIN
  FOR r IN
    SELECT con.conname AS fk_name,
           cl.relname  AS child_table,
           pl.relname  AS parent_table,
           ca.attname  AS child_col,
           pa.attname  AS parent_col
    FROM pg_constraint con
    JOIN pg_class cl     ON cl.oid = con.conrelid
    JOIN pg_class pl     ON pl.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_attribute ca ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'app_data'
      AND array_length(con.conkey, 1) = 1   -- single-column FKs (all of them today)
    ORDER BY cl.relname, con.conname
  LOOP
    -- Only scope by tenant when the child table carries tenant_id (all app_data
    -- entity tables do; a handful of pure lookup tables may not).
    has_tenant := EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = format('app_data.%I', r.child_table)::regclass
        AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
    );

    -- %I quotes identifiers, %L quotes the uuid literal — injection-safe.
    -- Anti-join: child rows with a non-null FK and no matching parent.
    EXECUTE format(
      'SELECT count(*) FROM app_data.%I c WHERE %s c.%I IS NOT NULL '
        || 'AND NOT EXISTS (SELECT 1 FROM app_data.%I p WHERE p.%I = c.%I)',
      r.child_table,
      CASE WHEN has_tenant THEN format('c.tenant_id = %L AND', p_tenant_id) ELSE '' END,
      r.child_col, r.parent_table, r.parent_col, r.child_col
    ) INTO n;

    IF n > 0 THEN
      child_table  := r.child_table;
      fk_name      := r.fk_name;
      parent_table := r.parent_table;
      orphan_count := n;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_migration_orphans(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_migration_orphans(uuid) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0038_migration_orphans_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
