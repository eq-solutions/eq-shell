-- Migration: 2026_06_25_drop_audit_log_user_fk
-- Target:    eq-canonical (jvknxcmbtrfnxfrwfimn) only
-- Purpose:   Remove FK constraint audit_log_user_id_fkey on public.audit_log.
--
--            The constraint FOREIGN KEY (user_id) REFERENCES auth.users(id)
--            had no ON DELETE action. Supabase Auth's delete trigger INSERTs a
--            new audit row *after* removing the auth.users row, which violated
--            the FK on insert and caused all auth.users hard-deletes to 500.
--
--            Correct design: audit_log.user_id is historical reference.
--            User records can be removed while audit history must survive.
--            Removing the FK enforces nothing useful and breaks user deletion.
--
--            Also: at time of removal the constraint was already invalid —
--            3 pre-existing orphaned rows referenced user_ids no longer in
--            auth.users (06cb638e, 7645dcee), meaning the constraint was not
--            providing integrity guarantees.
--
--            Applied out-of-band on 2026-06-25 during ghost account cleanup
--            (Huon Henne dedup — ghost auth user 22feec24).
--
-- Idempotent: safe to run even if constraint is already absent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'audit_log'
      AND constraint_name   = 'audit_log_user_id_fkey'
      AND constraint_type   = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_user_id_fkey;
  END IF;
END $$;
