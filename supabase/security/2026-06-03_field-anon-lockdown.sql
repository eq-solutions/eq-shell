-- 2026-06-03 — EQ Field anon-exposure lockdown (Phase-0 quick wins)
-- Applied manually via Supabase MCP, verified with has_table_privilege.
-- Part of the EQ Field anon remediation (see remediation sprint). Reversible (REVOKE only;
-- no data dropped). service_role access is unaffected throughout.
--
-- Context: the EQ Field data planes carried legacy `public.*` tables with USING(true) anon
-- policies, reachable by the publishable anon key. These two changes close the lowest-risk
-- portion immediately, ahead of the surface-by-surface cutover to canonical `app_data`.

-- ── Migration A — zaap (eq-canonical-internal, zaapmfdkgedqupfjtchl) ──────────────
-- Lock the 11 tables EQ Field never queries (verified in the Field usage map). No app impact.
REVOKE ALL ON
  public.buddy_checkins, public.checkins, public.engagement_log,
  public.field_customers, public.field_waitlist, public.leave_balances,
  public.qualifications, public.quarterly_reviews, public.rate_limits,
  public.staff_availability, public.unavailability
FROM anon, authenticated;

-- ── Migration B — ktmj (eq-solves-field, ktmjmdzqrogauaevbktn) ────────────────────
-- The original standalone Field project: stale for routing (registry → zaap) but still live
-- with ~637 staff PII rows, fully anon-open. Comprehensive lockdown of its public schema.
-- (Data preserved; export + project decommission tracked as a follow-up.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;  -- note: schema USAGE persists via the
  -- PUBLIC pseudo-role; harmless without table grants (verified anon has no table privilege).

-- Rollback (if a lockdown breaks a consumer): re-GRANT the specific privileges to anon as needed,
-- e.g.  GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO anon;
