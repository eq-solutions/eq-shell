-- Migration: 0044_tender_nomination_clashes_rls
-- Target:    every tenant data-plane project (app_data schema)
-- Purpose:   Silence the Supabase security-advisor warning on
--            app_data.tender_nomination_clashes by asserting its security
--            posture explicitly. The object is a VIEW (not a table) — RLS
--            cannot be enabled on views. The correct posture for a view in an
--            RLS environment is security_invoker = on, which causes the view
--            to execute with the CALLER's credentials so the underlying
--            tender_nominations table's RLS policies apply when accessed by an
--            authenticated user. service_role bypasses RLS regardless.
--
-- WHY A CONDITIONAL DO BLOCK:
--   The view exists on the sks (ehowgjardagevnrluult) plane but not on the
--   core (zaapmfdkgedqupfjtchl) plane — it was created out-of-band on sks.
--   On core the IF condition is false and the block is a safe no-op.
--   On sks the view is already service_role-only (no anon/authenticated
--   grants), so this is defence-in-depth: if grants are ever added later,
--   the underlying table's RLS will still protect cross-tenant access.
--
-- Safe: ALTER VIEW ... SET (security_invoker = on) is idempotent.
-- The runner records the ledger row on apply; this file writes no ledger row.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app_data'
      AND c.relname = 'tender_nomination_clashes'
      AND c.relkind = 'v'
  ) THEN
    ALTER VIEW app_data.tender_nomination_clashes SET (security_invoker = on);
  END IF;
END $$;
