-- ============================================================
-- Migration 0030: Drop Job Plan Reference Images
--
-- Reverses migration 0029 — removes the per-item reference
-- image feature. The generic image components (ImageUpload,
-- ImageThumbnail, ImageLightbox) are retained for future use.
-- ============================================================

-- 1. Drop columns from maintenance_check_items (snapshot side)
ALTER TABLE public.maintenance_check_items
  DROP COLUMN IF EXISTS reference_image_url,
  DROP COLUMN IF EXISTS reference_image_caption;

-- 2. Drop columns from job_plan_items (master side)
ALTER TABLE public.job_plan_items
  DROP COLUMN IF EXISTS reference_image_url,
  DROP COLUMN IF EXISTS reference_image_caption;

-- 3. Remove the storage bucket and its contents.
-- Objects must be deleted before the bucket can be dropped.
--
-- 2026-05-15 update: wrapped in exception-handling DO blocks because
-- newer Supabase versions block direct DML on storage tables with
--   ERROR: Direct deletion from storage tables is not allowed.
--   Use the Storage API instead. (SQLSTATE 42501)
-- Prod ran this migration when the policy still allowed direct DELETE
-- so the rows are already gone. On a fresh replay (CI integration tests)
-- the bucket doesn't exist either, so the DELETEs are no-ops anyway.
-- The DO block swallows the policy error so the chain doesn't break.
DO $$
BEGIN
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'job-plan-references';
  EXCEPTION WHEN insufficient_privilege OR others THEN NULL;
  END;
  BEGIN
    DELETE FROM storage.buckets WHERE id = 'job-plan-references';
  EXCEPTION WHEN insufficient_privilege OR others THEN NULL;
  END;
END $$;
