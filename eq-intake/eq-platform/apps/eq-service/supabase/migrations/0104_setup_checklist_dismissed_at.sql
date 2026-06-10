-- Migration 0104: tenant_members.setup_checklist_dismissed_at — admin dismissal flag.
--
-- Background
-- ----------
-- The dashboard shows a full-page onboarding checklist for admin/super_admin
-- users of any tenant that hasn't completed its first maintenance check.
-- Returning admins (setting up tenant #2, or just poking around an empty
-- demo tenant) had no way past it — the checklist owned the whole dashboard
-- until all 7 steps ticked off. This column lets them dismiss it; once
-- dismissed the normal dashboard renders with a thin "Setup N/7" chip
-- pinned above it so the scaffolding is still one click away.
--
-- Per-tenant_members (not per-user) so an admin who works across multiple
-- tenants gets the checklist on each new tenant they join. Nullable —
-- null = never dismissed (the default; checklist still shows).
--
-- Mirrors the tech_onboarded_at pattern from migration 0102.

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at timestamptz;

COMMENT ON COLUMN public.tenant_members.setup_checklist_dismissed_at IS
  'Timestamp the admin dismissed the dashboard onboarding checklist on this tenant. Null = never dismissed. Read by app/(app)/dashboard/page.tsx — when set the dashboard renders the normal KPI view with a small Setup progress chip above it; the full checklist is still reachable via ?setup=show. Cleared by restoreSetupChecklistAction.';
