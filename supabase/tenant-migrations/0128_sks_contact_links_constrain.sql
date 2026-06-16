-- Migration: 0128_sks_contact_links_constrain
-- Target:    SKS tenant plane (ehowgjardagevnrluult) — no-op on other planes
-- Purpose:   Add NOT NULL + PRIMARY KEY to public.sks_contact_links so that
--            the eq-quotes canonical upsert (ON CONFLICT contact_id,customer_id)
--            works. The table was created without constraints; 350 existing rows
--            have no NULLs and no duplicate pairs — safe to constrain.
--            Fixes EQ-QUOTES-D: _sks_contact_links_raw not found in schema cache.
-- Idempotent: yes (DO block checks for existing PK before adding)

BEGIN;

DO $$
BEGIN
  -- Only run if the table exists (ehow only; no-op on zaap and future tenants)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sks_contact_links'
  ) THEN
    RAISE NOTICE 'sks_contact_links not found — skipping 0128';
    RETURN;
  END IF;

  -- Add NOT NULL if not already set
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sks_contact_links'
      AND column_name = 'contact_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.sks_contact_links
      ALTER COLUMN contact_id SET NOT NULL,
      ALTER COLUMN customer_id SET NOT NULL;
  END IF;

  -- Add PRIMARY KEY if not already present
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sks_contact_links'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.sks_contact_links
      ADD CONSTRAINT sks_contact_links_pkey PRIMARY KEY (contact_id, customer_id);
  END IF;
END $$;

COMMIT;
