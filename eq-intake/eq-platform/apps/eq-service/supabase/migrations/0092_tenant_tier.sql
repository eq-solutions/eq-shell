-- ============================================================
-- Migration 0092: Phase A of the tier framework.
--
-- Visibility-only this phase — schema + backfill, no enforcement.
-- The Plan chip in the header reads `tenant_settings.tier` and
-- `tenant_settings.compliance_tier`; nothing in the app blocks based
-- on these yet. We'll wire enforcement in a later phase once we've
-- watched usage for a sprint.
--
-- Two dimensions:
--   tier             — scale dimension (starter / team / enterprise)
--   compliance_tier  — compliance posture (standard / enhanced /
--                      enterprise) — Jemena's lesson: a customer can
--                      be small on scale but enterprise-grade on
--                      procurement bar.
--
-- Lives on `tenants` (not `tenant_settings`) because it's structural
-- about the tenant, not a customisable setting. `tenant_settings` is
-- already a wide table; adding tier here keeps the concepts cleanly
-- separated and lets RLS policies on `tenants` cover it.
--
-- Backfill: every existing tenant → 'team' / 'standard'. Today that's
-- only SKS and Demo, and both already get every Team-tier feature, so
-- this is non-breaking. SKS will likely flip to 'enterprise' (and
-- 'enhanced' compliance) when post-VIC expansion lands; that's a
-- manual UPDATE in the future, no migration needed.
-- ============================================================

-- ── 1. Enums ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_tier') THEN
    CREATE TYPE public.tenant_tier AS ENUM ('starter', 'team', 'enterprise');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_compliance_tier') THEN
    CREATE TYPE public.tenant_compliance_tier AS ENUM ('standard', 'enhanced', 'enterprise');
  END IF;
END$$;

-- ── 2. Columns on tenants ──────────────────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tier             public.tenant_tier            NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS compliance_tier  public.tenant_compliance_tier NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.tenants.tier IS
  'Scale tier. Drives the Plan chip in the header and (post-Phase-A) usage limits + feature gates. Defaults to ''team'' to preserve current behaviour for SKS + Demo. Change via direct UPDATE — no UI for tier changes yet.';

COMMENT ON COLUMN public.tenants.compliance_tier IS
  'Compliance posture. Independent of scale tier (Jemena pattern: small contract, enterprise-grade procurement bar). Defaults to ''standard''. Drives audit-log retention, SOC 2 evidence pack inclusion, and SSO availability in later phases.';

-- ── 3. Explicit backfill — paranoid, defaults already covered it ───

UPDATE public.tenants
   SET tier            = COALESCE(tier, 'team'),
       compliance_tier = COALESCE(compliance_tier, 'standard')
 WHERE tier IS NULL OR compliance_tier IS NULL;

-- ── 4. Helper view for the Plan chip ───────────────────────────────
-- Joins tenant + name + tier + compliance_tier for the chip's single
-- query. Single source of truth so the chip component doesn't have
-- to know about the underlying column layout. RLS on tenants flows
-- through to the view.

CREATE OR REPLACE VIEW public.tenant_tier_view AS
  SELECT
    t.id           AS tenant_id,
    t.name         AS tenant_name,
    t.tier,
    t.compliance_tier,
    t.is_active
  FROM public.tenants t;

ALTER VIEW public.tenant_tier_view SET (security_invoker = true);

COMMENT ON VIEW public.tenant_tier_view IS
  'Read-only join of tenants + tier + compliance_tier for the Plan chip in the global header. security_invoker = true so RLS on tenants applies.';

GRANT SELECT ON public.tenant_tier_view TO authenticated;
