-- Migration: 0084_field_views_security_invoker
-- Target:    Per-tenant data plane
-- Purpose:   Security fix — make the EQ Field reporting views enforce the querying
--            user's RLS instead of the view owner's.
--
--   Supabase security advisor (rule 0010, security_definer_view, ERROR) flagged 8
--   views that run with the definer's privileges, bypassing the caller's row-level
--   security on the underlying tables. Verified safe to switch to SECURITY INVOKER:
--   every base table already has RLS enabled with an authenticated-applicable policy
--   AND grants SELECT to `authenticated`, so EQ Field's signed-in, tenant-scoped reads
--   keep working — and now get correctly filtered per tenant at query time instead of
--   relying on the view to (not) filter.
--
--   Owned by eq-shell tenant-migrations (created in 0050/0052/0055/0057), so this is
--   the correct place to fix them.
--
-- Idempotent (SET (security_invoker = true) is repeatable).

ALTER VIEW app_data.field_site_diaries   SET (security_invoker = true);
ALTER VIEW app_data.field_schedule       SET (security_invoker = true);
ALTER VIEW app_data.field_timesheets     SET (security_invoker = true);
ALTER VIEW app_data.field_leave_requests SET (security_invoker = true);
ALTER VIEW app_data.field_audit_log      SET (security_invoker = true);
ALTER VIEW app_data.field_prestarts      SET (security_invoker = true);
ALTER VIEW app_data.field_toolbox_talks  SET (security_invoker = true);
ALTER VIEW public.nomination_clashes     SET (security_invoker = true);
