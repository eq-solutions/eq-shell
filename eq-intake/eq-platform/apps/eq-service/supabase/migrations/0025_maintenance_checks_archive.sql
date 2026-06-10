-- 0025: add soft-delete (is_active) to maintenance_checks
-- A maintenance check can be archived without losing history. Archived checks
-- are hidden from the default list views but remain queryable for auditing.

ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_maintenance_checks_is_active
  ON public.maintenance_checks (tenant_id, is_active);

COMMENT ON COLUMN public.maintenance_checks.is_active IS
  'Soft-delete flag. false = archived/hidden from default list views.';
