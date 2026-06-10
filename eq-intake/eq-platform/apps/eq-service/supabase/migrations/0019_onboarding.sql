-- Add onboarding completion flag to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz DEFAULT NULL;

-- Comment
COMMENT ON COLUMN public.tenants.setup_completed_at IS 'Null = onboarding not completed, set when wizard finishes';
