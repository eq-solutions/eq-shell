-- ============================================================
-- Migration 0029: Job Plan Reference Images (Visual Guided Workflow)
--
-- Adds reference image support to job plan items so admins can
-- attach a photo or diagram to each task. The image is shown
-- inline next to the task in the maintenance check UI so the
-- technician can see exactly what they are inspecting.
--
-- The column is added to BOTH `job_plan_items` (the master) and
-- `maintenance_check_items` (the point-in-time snapshot taken
-- when a check is created). Denormalising to the snapshot keeps
-- historical checks stable — editing the job plan image later
-- does not rewrite past check UIs.
--
-- Reference images live in a new public `job-plan-references`
-- storage bucket. Public read is intentional: these are generic
-- SOP diagrams, not tenant data. Write is locked down via the
-- server action (admin role only) — the client never uploads
-- directly, so we do not need a storage RLS write policy.
-- ============================================================

-- 1. Master columns on job_plan_items
ALTER TABLE public.job_plan_items
  ADD COLUMN IF NOT EXISTS reference_image_url text,
  ADD COLUMN IF NOT EXISTS reference_image_caption text;

COMMENT ON COLUMN public.job_plan_items.reference_image_url IS
  'Public URL of a reference photo/diagram for this task. Shown inline '
  'in the maintenance check UI so the technician can see exactly what to inspect.';
COMMENT ON COLUMN public.job_plan_items.reference_image_caption IS
  'Optional caption shown under the reference image.';

-- 2. Snapshot columns on maintenance_check_items — populated at
-- check creation time from the parent job_plan_items row.
ALTER TABLE public.maintenance_check_items
  ADD COLUMN IF NOT EXISTS reference_image_url text,
  ADD COLUMN IF NOT EXISTS reference_image_caption text;

COMMENT ON COLUMN public.maintenance_check_items.reference_image_url IS
  'Snapshot of the parent job_plan_item reference image URL, taken at check creation. '
  'Decoupled from the master so historical checks are stable.';

-- 3. Storage bucket — public read, no RLS write (server action gates writes).
INSERT INTO storage.buckets (id, name, public)
  VALUES ('job-plan-references', 'job-plan-references', true)
  ON CONFLICT (id) DO NOTHING;
