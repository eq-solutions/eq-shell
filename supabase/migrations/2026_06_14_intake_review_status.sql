-- Intake review queue: widen eq_intake_events.status.
--
-- The staged intake-review flow (eq_intake_staging on the tenant data plane,
-- migration 0012) introduces two control-plane lifecycle states that the
-- existing status CHECK doesn't allow yet:
--
--   pending_review — the batch has been parsed + staged; rows are sitting in
--                    eq_intake_staging awaiting a reviewer's approve/reject.
--                    Distinct from 'awaiting_confirm', which is the transient
--                    in-browser confirm step during a single import session.
--   rejected       — terminal state: the reviewer declined the whole batch.
--                    Distinct from 'failed', which means an error, not a human
--                    decision.
--
-- Purely additive: only widens the allowed set, so no existing row can be in
-- violation. The aggregate health summary (score, conflict_count,
-- flagged_count) is stashed in the existing validation_summary jsonb column —
-- no new columns required; rows_flagged / rows_rejected already exist.

ALTER TABLE shell_control.eq_intake_events
  DROP CONSTRAINT IF EXISTS eq_intake_events_status_check;

ALTER TABLE shell_control.eq_intake_events
  ADD CONSTRAINT eq_intake_events_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'mapping'::text,
    'validating'::text,
    'awaiting_confirm'::text,
    'committing'::text,
    'completed'::text,
    'failed'::text,
    'rolled_back'::text,
    'pending_review'::text,
    'rejected'::text
  ]));
