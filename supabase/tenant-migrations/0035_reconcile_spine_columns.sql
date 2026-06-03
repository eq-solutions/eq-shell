-- =============================================================================
-- Migration 0035: Reconcile the final spine column divergences
--
-- The semantic drift guard (`check-tenant-drift --strict-spine`, eq-shell #157)
-- reduced the real cross-tenant spine drift to exactly these column differences
-- (the other 160+ were cosmetic policy decomposition). This migration brings
-- every tenant to the canonical choice — idempotent + type-aware, so it is a
-- no-op on whichever tenant is already canonical. After it applies fleet-wide,
-- `--strict-spine` is green and can be flipped to a required blocking gate.
--
-- DECISIONS (grounded in live data, verified read-only 2026-06-03):
--
--   1. tenant_id : text -> uuid  on briefing_actions, briefing_cache,
--      gm_report_periods.
--        tenant_id is a UUID everywhere else in the spine; the EQ tenant held
--        these three as text (the SKS tenant already had uuid). 0-1 rows each,
--        all valid UUIDs, so the cast is safe. The tenant-scoped SELECT policy
--        on each is dropped + recreated with the uuid cast so the gate matches
--        the new column type (and converges with the SKS tenant's existing
--        uuid-cast gate). gm_report_jobs gates THROUGH gm_report_periods, so its
--        policy is realigned too.
--
--   2. contacts.customer_id : NOT NULL -> NULLABLE.
--        The SKS tenant legitimately has 53 contacts with no customer link; the
--        EQ tenant's NOT NULL was over-strict. Nullable is the correct,
--        always-safe canonical. (Deleting/backfilling 53 real rows to force
--        NOT NULL would be wrong.)
--
--   3. licences.licence_number : NULLABLE -> NOT NULL.
--        Every licence has a number (0 NULLs on either tenant); NOT NULL is the
--        correct canonical. Guarded so it can never fail a tenant that somehow
--        has NULLs (it skips with a notice rather than erroring the fleet run).
--
-- Apply via the One Pipe runner ONLY (gated). Idempotent: re-running is a no-op.
-- =============================================================================

BEGIN;

-- ── 1. tenant_id text -> uuid (+ realign the tenant-scoped SELECT policy) ──────
-- Per table, only when the column is still text. DROP the tenant-gate policy
-- first (it references tenant_id as text), convert the column, then recreate the
-- policy with the uuid cast. The service_role and per-user (auth.uid()) policies
-- do not reference tenant_id, so they are untouched.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('briefing_actions',  'Tenant sees own briefing actions'),
      ('briefing_cache',    'Tenant sees own briefing'),
      ('gm_report_periods', 'Tenant sees own periods')
    ) AS v(tbl, policy)
  LOOP
    IF (SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'app_data' AND table_name = r.tbl AND column_name = 'tenant_id') = 'text' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON app_data.%I', r.policy, r.tbl);
      EXECUTE format('ALTER TABLE app_data.%I ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid', r.tbl);
      EXECUTE format(
        'CREATE POLICY %I ON app_data.%I FOR SELECT TO authenticated '
        'USING (tenant_id = ((auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')::uuid))',
        r.policy, r.tbl);
    END IF;
  END LOOP;
END$$;

-- gm_report_jobs has no tenant_id of its own — it gates through
-- gm_report_periods.tenant_id. Recreate its SELECT policy with the uuid cast so
-- the subquery comparison is uuid = uuid. Idempotent (drop + recreate to the
-- canonical definition; a no-op in effect where already uuid-cast).
DROP POLICY IF EXISTS "Tenant sees own jobs" ON app_data.gm_report_jobs;
CREATE POLICY "Tenant sees own jobs" ON app_data.gm_report_jobs
  FOR SELECT TO authenticated
  USING (period_id IN (
    SELECT id FROM app_data.gm_report_periods
    WHERE tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  ));

-- ── 2. contacts.customer_id -> NULLABLE (no-op where already nullable) ─────────
ALTER TABLE app_data.contacts ALTER COLUMN customer_id DROP NOT NULL;

-- ── 3. licences.licence_number -> NOT NULL (guarded; skips if any NULLs) ───────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_data.licences WHERE licence_number IS NULL) THEN
    ALTER TABLE app_data.licences ALTER COLUMN licence_number SET NOT NULL;
  ELSE
    RAISE NOTICE 'licences.licence_number has NULL(s) on this tenant — left nullable; backfill then re-run.';
  END IF;
END$$;

COMMIT;
