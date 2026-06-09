-- Migration: 0062_security_advisor_qualifications
-- Target:    every tenant data-plane project (ehowgjardagevnrluult + zaapmfdkgedqupfjtchl)
-- Purpose:   Drop always-true INSERT/UPDATE/DELETE policies on public.qualifications (zaap).
--            The SELECT policy with USING(true) is intentionally excluded by the advisor
--            (public read of a lookup table is acceptable). The write policies are not.
--            Safe no-op on ehowg if the table/policies don't exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'qualifications'
  ) THEN
    DROP POLICY IF EXISTS qualifications_anon_delete ON public.qualifications;
    DROP POLICY IF EXISTS qualifications_anon_insert ON public.qualifications;
    DROP POLICY IF EXISTS qualifications_anon_update ON public.qualifications;
    -- Revoke write privileges from anon/authenticated; service_role bypasses RLS
    REVOKE INSERT, UPDATE, DELETE ON public.qualifications FROM PUBLIC, anon, authenticated;
    GRANT INSERT, UPDATE, DELETE ON public.qualifications TO service_role;
  END IF;
END $$;
