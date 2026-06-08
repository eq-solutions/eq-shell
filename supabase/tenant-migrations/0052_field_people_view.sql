-- 0052_field_people_view.sql
--
-- Creates app_data.field_people as a view over app_data.staff.
-- EQ Field's supabase.js JWT routing rewrites `people` → `field_people` so
-- the JWT-authenticated path lands on this view. The view uses
-- security_invoker=on so queries run as the authenticated user and RLS on
-- app_data.staff (tenant_isolation policy) filters correctly.
--
-- Column mapping matches Field's expected people object shape:
--   id          ← staff_id  (uuid PK)
--   name        ← COALESCE(preferred_name, first_name || ' ' || last_name)
--   group       ← employment_type  (no `group` column on staff — see loadCanonicalStaffMap comment)
--   tenant_id   ← tenant_id  (RLS passthrough)
--   active      ← active
--   field_approved ← field_approved
--
-- Filter: only field_approved=true or field_approved IS NULL (grandfathered)
-- rows are visible through this view. This enforces the E1 acceptance criterion
-- at the view layer — every Field query against people sees only approved staff.
--
-- This view replaces the in-place SKS public.people path. After removing 'sks'
-- from JWT_INPLACE_TENANTS in supabase.js, gate-dropdown and roster queries
-- go to app_data.field_people (this view) on ehow instead of public.people on nspbmir.
--
-- Applied to both zaap and ehow (zaap also has app_data.staff from migration 0046).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'staff'
  ) THEN
    RETURN;
  END IF;

  -- Drop field_people if it was previously created as a base table
  -- (zaap had a field_people table from an earlier ETL; can't CREATE OR REPLACE VIEW over a table).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_data' AND table_name = 'field_people'
    AND table_type = 'BASE TABLE'
  ) THEN
    EXECUTE 'DROP TABLE app_data.field_people CASCADE';
  END IF;

  EXECUTE $sql$
    CREATE OR REPLACE VIEW app_data.field_people AS
    SELECT
      staff_id                                                              AS id,
      tenant_id,
      COALESCE(preferred_name, first_name || ' ' || last_name)             AS name,
      employment_type                                                       AS "group",
      field_approved,
      active,
      created_at,
      updated_at
    FROM app_data.staff
    WHERE (field_approved IS TRUE OR field_approved IS NULL)
      AND active IS NOT FALSE;
  $sql$;

  EXECUTE $sql$
    ALTER VIEW app_data.field_people SET (security_invoker = on);
  $sql$;

  EXECUTE $sql$
    GRANT SELECT ON app_data.field_people TO authenticated;
  $sql$;
END $$;
