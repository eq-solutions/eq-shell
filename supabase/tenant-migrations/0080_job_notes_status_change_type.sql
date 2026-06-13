-- Migration: 0080_job_notes_status_change_type
-- Target:    Per-tenant data plane
-- Purpose:   CRITICAL correctness fix — allow the note_type the app already emits.
--
--   eq_update_quote_status writes a timeline note with note_type = 'status-change',
--   and the quotes UI styles that type specially (eq-quotes__note--status, and the
--   "status" pill). But job_notes_type_check only permitted
--   ('manual','email','call','site-visit','system'), so the insert failed:
--       ERROR 23514: new row ... violates check constraint "job_notes_type_check"
--   This was the last blocker on native status transitions (see 0078/0079).
--
--   Fix: widen the constraint to include 'status-change' so the existing RPC and
--   UI work as designed. Existing rows are unaffected.
--
-- Idempotent (DROP IF EXISTS + ADD).

ALTER TABLE app_data.job_notes DROP CONSTRAINT IF EXISTS job_notes_type_check;

ALTER TABLE app_data.job_notes ADD CONSTRAINT job_notes_type_check
  CHECK (note_type = ANY (ARRAY['manual', 'email', 'call', 'site-visit', 'system', 'status-change']));
