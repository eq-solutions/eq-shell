-- ============================================================
-- Migration 0072: Assets — parent-child, logical groups, cycle anchors,
-- pm-in-scope flag, block/zone metadata.
--
-- Findings driving this (audit 2026-04-27):
--
--   - Parent-child: 757 NSX-style breakers at SY3 sit inside MSBs/panels.
--     Equinix doesn't PM the breakers separately, but they're touched when
--     the parent MSB is touched. Need an asset.parent_id so PM events on
--     the parent cascade visibility to the children.
--
--   - is_logical_group: M10.13 Emergency Lighting at SY3 has qty=1 but
--     represents the site-wide emergency lighting fabric, not a single
--     fixture. M14.29 Lighting Control, E1.36 Earthing — same pattern.
--     Royce confirmed 2026-04-27 these are deliberate logical roll-ups.
--     But at SY9, M14.29 = 46 individual physical lighting control panels.
--     So the flag is per-asset, not global per-JP.
--
--   - pm_in_scope: NSX MCCBs at SY3 are registered as assets but no JP
--     covers them. They're physically maintained by adjacency to parent
--     panel work. EQ Service should not schedule them but should display
--     them in the asset register.
--
--   - block_or_zone: SY9 has "R BLOCK ONLY" appearing in three calendar
--     entries — partial-site scheduling for switchboard work. Need block /
--     zone metadata on assets so calendar entries can target subsets.
--
--   - last_pm_per_cycle / next_due_per_cycle: cycle anchor dates are tribal
--     knowledge today (Royce confirmed). Storing per-asset removes that risk
--     and lets EQ Service forecast next year's calendar from the data alone.
--
-- All additive + nullable.
-- ============================================================

ALTER TABLE public.assets
  -- Hierarchy
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  -- Logical roll-up flag
  ADD COLUMN IF NOT EXISTS is_logical_group boolean NOT NULL DEFAULT false,
  -- PM-in-scope flag (for assets registered but not scheduled)
  ADD COLUMN IF NOT EXISTS pm_in_scope boolean NOT NULL DEFAULT true,
  -- Block / zone metadata
  ADD COLUMN IF NOT EXISTS block_or_zone text,
  -- Commission anchor
  ADD COLUMN IF NOT EXISTS commissioned_date date,
  -- Cycle history (per cycle frequency)
  ADD COLUMN IF NOT EXISTS last_pm_per_cycle jsonb DEFAULT '{}'::jsonb,
    -- Shape: { "1YR": "2026-02-02", "5YR": "2024-08-15" }
  ADD COLUMN IF NOT EXISTS next_due_per_cycle jsonb DEFAULT '{}'::jsonb,
    -- Shape: { "1YR": "2027-02-02", "5YR": "2029-08-15" }
  ADD COLUMN IF NOT EXISTS cycle_anchor_notes text;
    -- Free-text capture of any cycle-context that doesn't fit the structured fields

-- Indexes
CREATE INDEX IF NOT EXISTS assets_parent_idx
  ON public.assets(parent_id) WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assets_logical_group_idx
  ON public.assets(tenant_id, is_logical_group) WHERE is_logical_group = true;

CREATE INDEX IF NOT EXISTS assets_pm_out_of_scope_idx
  ON public.assets(tenant_id, pm_in_scope) WHERE pm_in_scope = false;

CREATE INDEX IF NOT EXISTS assets_block_idx
  ON public.assets(site_id, block_or_zone) WHERE block_or_zone IS NOT NULL;

-- GIN for forecasting next-year due assets
CREATE INDEX IF NOT EXISTS assets_next_due_gin
  ON public.assets USING gin (next_due_per_cycle);

COMMENT ON COLUMN public.assets.parent_id IS
  'Parent asset (e.g. an MSB is parent to its feeder breakers). PM events on the parent should cascade visibility to children. NULL for top-level assets.';

COMMENT ON COLUMN public.assets.is_logical_group IS
  'True when the asset represents a site-wide system (Emergency Lighting fabric, Earthing System) rather than a single physical thing. Don''t expect a barcode scan to mark done.';

COMMENT ON COLUMN public.assets.pm_in_scope IS
  'False when the asset is registered for completeness but no JP schedules PM for it (e.g. NSX MCCBs at SY3). Calendar generator skips these.';

COMMENT ON COLUMN public.assets.block_or_zone IS
  'Site sub-zone this asset lives in (e.g. "R Block" at SY9). Calendar entries can target a subset by block_or_zone.';

COMMENT ON COLUMN public.assets.last_pm_per_cycle IS
  'Per-cycle last-PM dates. Shape: {"1YR": "2026-02-02", "5YR": "2024-08-15"}. Replaces tribal knowledge of cycle anchors.';

COMMENT ON COLUMN public.assets.next_due_per_cycle IS
  'Per-cycle next-due dates derived from last_pm_per_cycle + cycle interval. Drives the year-ahead calendar generator.';
