-- Migration 0071: Fix rcd_test_circuits unique constraint to be section-aware.
--
-- The original constraint from migration 0069 was UNIQUE (rcd_test_id, circuit_no),
-- which treated circuits with the same number across different sections as
-- duplicates. But Jemena's multi-section boards (Cardiff DB-1, etc.) have
-- "Lighting Section" circuit 1 AND "Power Section" circuit 1 — distinct
-- physical circuits, both legitimate.
--
-- First import of Cardiff RCD xlsx (3 boards, 77 circuits) tripped this on
-- DB-1. Caught in production 2026-04-27.
--
-- Replace with a section-aware unique constraint using NULLS NOT DISTINCT
-- (PG 15+) so unsectioned boards (where section_label IS NULL) still get
-- the duplicate-prevention they need.

ALTER TABLE public.rcd_test_circuits
  DROP CONSTRAINT IF EXISTS rcd_test_circuits_rcd_test_id_circuit_no_key;

ALTER TABLE public.rcd_test_circuits
  ADD CONSTRAINT rcd_test_circuits_test_section_circuit_unique
    UNIQUE NULLS NOT DISTINCT (rcd_test_id, section_label, circuit_no);
