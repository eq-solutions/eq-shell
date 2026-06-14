-- Migration: 0089_quote_section_oneoff
-- Target:    Per-tenant data plane
-- Purpose:   Add a fourth line-item section — "one-off" — to the allowed
--            category set, so quotes can separate one-off / once-off items from
--            labour / materials / subcontractors.
--
--   The quote_line_item.category CHECK previously allowed
--   (labour, material, equipment, subcontractor, other). We keep those (existing
--   rows use labour/material/subcontractor) and ADD 'one_off'. No data migration:
--   the stored keys are unchanged; only the UI labelling becomes the fixed
--   four-section set (Labour / Materials / Subcontractors / One-off).
--
-- Idempotent (DROP CONSTRAINT IF EXISTS + ADD).

ALTER TABLE app_data.quote_line_item DROP CONSTRAINT IF EXISTS line_category_valid;

ALTER TABLE app_data.quote_line_item
  ADD CONSTRAINT line_category_valid
  CHECK (
    category IS NULL
    OR category = ANY (ARRAY[
      'labour'::text,
      'material'::text,
      'equipment'::text,
      'subcontractor'::text,
      'other'::text,
      'one_off'::text
    ])
  );
