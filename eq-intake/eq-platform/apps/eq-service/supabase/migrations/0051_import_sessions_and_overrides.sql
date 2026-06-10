-- Migration: 0051_import_sessions_and_overrides
-- Purpose:   Persist inline user fixes made during a Delta/Maximo WO import
--            (e.g. "accept fuzzy alias LBS → LB", "link row 248 to EQ asset X",
--             "create asset for row 245", "skip row 246", "skip this group")
--            across Re-parse uploads of the same workbook, so the user can
--            resolve issues one by one without losing progress.
-- Applied:   2026-04-19 to project urjhmkhbgaxrofurpbgc via Supabase MCP.
-- Rollback:
--   DROP TABLE public.import_overrides CASCADE;
--   DROP TABLE public.import_sessions CASCADE;
--
-- Convention note: uses `tenant_id = ANY(public.get_user_tenant_ids())`
-- directly (matches 0044–0049). An earlier draft wrapped the function call
-- in `(select …)` for the planner-cache trick from 0027, but that makes
-- Postgres treat the call as a row-returning subquery and blew up with
-- `operator does not exist: uuid = uuid[]`. The un-wrapped form still
-- benefits from the function being STABLE.

BEGIN;

-- ============================================================
-- 1. import_sessions — one row per upload wizard attempt
-- ============================================================

CREATE TABLE IF NOT EXISTS public.import_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_system  text NOT NULL DEFAULT 'delta'
    CHECK (source_system IN ('delta', 'maximo')),
  filename       text,
  file_hash      text NOT NULL,             -- sha256 hex of uploaded bytes
  row_count      integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  committed_at   timestamptz,               -- set when commit action succeeds
  committed_check_ids uuid[]                -- audit trail, not a hot path
);

COMMENT ON TABLE public.import_sessions IS
  'One wizard attempt to import an upstream work-order workbook. Holds a file hash so Re-parse requests can re-attach the same session and its overrides, and a committed_at timestamp so old sessions can be filtered out.';

CREATE INDEX IF NOT EXISTS import_sessions_tenant_idx
  ON public.import_sessions(tenant_id);

CREATE INDEX IF NOT EXISTS import_sessions_tenant_hash_idx
  ON public.import_sessions(tenant_id, file_hash)
  WHERE committed_at IS NULL;

DROP TRIGGER IF EXISTS import_sessions_set_updated_at ON public.import_sessions;
CREATE TRIGGER import_sessions_set_updated_at
  BEFORE UPDATE ON public.import_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. import_overrides — one row per inline fix inside a session
-- ============================================================
--
-- Targets are either a single parsed sheet row (scope='row', keyed by
-- row_number) or an entire parsed group (scope='group', keyed by group_key
-- from delta-wo-parser). A single target may only have one active override
-- at a time — the partial unique indexes below enforce that.

CREATE TABLE IF NOT EXISTS public.import_overrides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  import_session_id   uuid NOT NULL REFERENCES public.import_sessions(id) ON DELETE CASCADE,
  scope               text NOT NULL CHECK (scope IN ('row', 'group')),
  row_number          integer,
  group_key           text,
  action              text NOT NULL CHECK (action IN (
    'link_asset',       -- scope=row, payload { assetId }
    'create_asset',     -- scope=row, payload { assetId } (asset was just created server-side)
    'skip_row',         -- scope=row, payload {}
    'accept_alias',     -- scope=group, payload { jobPlanId, aliasId }
    'create_job_plan',  -- scope=group, payload { jobPlanId }
    'skip_group'        -- scope=group, payload {}
  )),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- scope <-> target column must line up
  CONSTRAINT import_overrides_scope_shape CHECK (
    (scope = 'row'   AND row_number IS NOT NULL AND group_key IS NULL)
    OR
    (scope = 'group' AND group_key  IS NOT NULL AND row_number IS NULL)
  )
);

COMMENT ON TABLE public.import_overrides IS
  'User decisions captured inline during the WO import wizard: accept a fuzzy alias, create a missing job plan, link a row to an EQ asset, create a new EQ asset, or skip a row/group. Consumed by previewDeltaImportAction to re-render the preview; consumed + marked applied by commitDeltaImportAction.';

CREATE INDEX IF NOT EXISTS import_overrides_session_idx
  ON public.import_overrides(import_session_id);

CREATE INDEX IF NOT EXISTS import_overrides_tenant_idx
  ON public.import_overrides(tenant_id);

-- One active override per (session, row) or (session, group).
CREATE UNIQUE INDEX IF NOT EXISTS import_overrides_session_row_uniq
  ON public.import_overrides(import_session_id, row_number)
  WHERE scope = 'row';

CREATE UNIQUE INDEX IF NOT EXISTS import_overrides_session_group_uniq
  ON public.import_overrides(import_session_id, group_key)
  WHERE scope = 'group';

-- ============================================================
-- 3. RLS — import_sessions
-- ============================================================

ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_sessions_select ON public.import_sessions;
CREATE POLICY import_sessions_select
  ON public.import_sessions FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

DROP POLICY IF EXISTS import_sessions_insert ON public.import_sessions;
CREATE POLICY import_sessions_insert
  ON public.import_sessions FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS import_sessions_update ON public.import_sessions;
CREATE POLICY import_sessions_update
  ON public.import_sessions FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
  )
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
  );

DROP POLICY IF EXISTS import_sessions_delete ON public.import_sessions;
CREATE POLICY import_sessions_delete
  ON public.import_sessions FOR DELETE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.is_tenant_admin(tenant_id)
  );

-- ============================================================
-- 4. RLS — import_overrides
-- ============================================================

ALTER TABLE public.import_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_overrides_select ON public.import_overrides;
CREATE POLICY import_overrides_select
  ON public.import_overrides FOR SELECT TO authenticated
  USING (tenant_id = ANY(public.get_user_tenant_ids()));

DROP POLICY IF EXISTS import_overrides_insert ON public.import_overrides;
CREATE POLICY import_overrides_insert
  ON public.import_overrides FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
    AND created_by = auth.uid()
  );

-- Overrides are replaceable via UPDATE so the client can swap a `skip_row`
-- for a `link_asset` on the same row without a delete+insert dance.
DROP POLICY IF EXISTS import_overrides_update ON public.import_overrides;
CREATE POLICY import_overrides_update
  ON public.import_overrides FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
  )
  WITH CHECK (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
  );

DROP POLICY IF EXISTS import_overrides_delete ON public.import_overrides;
CREATE POLICY import_overrides_delete
  ON public.import_overrides FOR DELETE TO authenticated
  USING (
    tenant_id = ANY(public.get_user_tenant_ids())
    AND public.get_user_role(tenant_id) IN ('super_admin','admin','supervisor')
  );

COMMIT;
