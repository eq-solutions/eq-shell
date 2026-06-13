-- Migration: 0068_sks_comms_events
-- @tenant-scope: sks
-- Target:    ehowgjardagevnrluult (SKS tenant plane only)
-- Purpose:   Audit event log for NSW Comms jobs.
--            Records every state change: who changed what and when.
--            One row per event; joined to sks_comms_jobs via job_id.
--            Service-role only — no browser path. Same posture as sks_comms_jobs.

CREATE TABLE IF NOT EXISTS app_data.sks_comms_events (
  event_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid        NOT NULL
               REFERENCES app_data.sks_comms_jobs(job_id) ON DELETE CASCADE,
  user_id    text        NOT NULL,   -- session.user_id UUID
  action     text        NOT NULL,   -- 'update_job' | 'add_line' | 'update_line'
  note       text,                   -- human-readable summary of the change
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sks_comms_events_job_idx
  ON app_data.sks_comms_events (job_id, created_at DESC);

GRANT SELECT, INSERT ON app_data.sks_comms_events TO service_role;
REVOKE ALL ON app_data.sks_comms_events FROM PUBLIC, anon, authenticated;
ALTER TABLE app_data.sks_comms_events ENABLE ROW LEVEL SECURITY;
