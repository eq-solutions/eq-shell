-- ============================================================
-- Migration 0060: Attachments — categorize + reset
--
-- Context: Royce's review (26 Apr 2026) confirmed attachments need a Type
-- field so the app can route uploads to the right surface:
--
--   - 'evidence'  → photos/videos on tests + defects. Auto-included on
--                   PDF reports as evidence appendix.
--   - 'reference' → SLDs, drawings, manuals, MSAs uploaded per site.
--                   Pinned to the site detail page for techs onsite.
--                   Not on reports.
--   - 'paperwork' → POs, customer signoffs, dockets attached to work
--                   orders. Internal record only.
--
-- Royce explicitly authorised wiping the existing attachments table +
-- bucket contents (decision logged in 2026-04-26 session): "Wipe everything
-- — re-populate demo at the end to ensure it looks populated for people to
-- view." Existing attachments are demo-quality only; no real customer
-- evidence has been uploaded yet.
--
-- This migration is destructive — DO NOT re-run on a tenant that has live
-- attachments. The Storage bucket is also wiped via a server action after
-- the SQL runs (storage objects can't be removed from inside a SQL
-- migration cleanly).
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Wipe existing rows
-- ---------------------------------------------------------------------------
-- Truncate is faster than DELETE and resets any identity sequences. CASCADE
-- isn't needed because nothing FKs into attachments.
TRUNCATE TABLE public.attachments;

-- ---------------------------------------------------------------------------
-- 2. Add the Type column
-- ---------------------------------------------------------------------------
-- Plain text + check constraint instead of a Postgres enum, because enums
-- are painful to extend later (would need a new migration just to add a
-- value). The check constraint gives the same safety with more flexibility.

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS attachment_type text NOT NULL DEFAULT 'evidence';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attachments_type_check'
  ) THEN
    ALTER TABLE public.attachments
      ADD CONSTRAINT attachments_type_check
      CHECK (attachment_type IN ('evidence', 'reference', 'paperwork'));
  END IF;
END$$;

COMMENT ON COLUMN public.attachments.attachment_type IS
  'Categorisation routing the attachment to the right surface:
   evidence  = photos/videos on tests + defects (shown on PDF reports);
   reference = drawings/SLDs/manuals on sites (techs grab onsite);
   paperwork = POs/signoffs/dockets on work orders (internal only).';

-- ---------------------------------------------------------------------------
-- 3. Index for category filtering on entity-scoped queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attachments_entity_type
  ON public.attachments(entity_type, entity_id, attachment_type);

CREATE INDEX IF NOT EXISTS idx_attachments_tenant_type
  ON public.attachments(tenant_id, attachment_type);
