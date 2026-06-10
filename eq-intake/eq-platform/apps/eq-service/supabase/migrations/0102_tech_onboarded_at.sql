-- Migration 0102: tenant_members.tech_onboarded_at — first-login dismissal flag.
--
-- Background
-- ----------
-- UX audit PR #149 §B.6 / PR I in the audit's PR slicing: technicians on
-- their first session of a tenant should see a one-card welcome on the
-- TechDashboard pointing them to their first assigned check. Dismissed
-- via a server action that stamps this column.
--
-- Per-tenant_members (not per-user) so a tech who works across multiple
-- tenants gets the welcome once per tenant. Nullable — null = never seen.

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS tech_onboarded_at timestamptz;

COMMENT ON COLUMN public.tenant_members.tech_onboarded_at IS
  'Timestamp the user first dismissed the technician welcome card on this tenant (PR I, audit §B.6). Null = card not yet dismissed. The card is shown for tenant_members rows with role=technician AND tech_onboarded_at IS NULL.';
