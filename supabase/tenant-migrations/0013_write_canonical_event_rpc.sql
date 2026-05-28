-- Migration: 0013_write_canonical_event_rpc
-- Target:    Per-tenant data plane
-- Purpose:   Provides a SECURITY DEFINER RPC that any EQ app can call (via
--            service-role key) to write a cross-app activity event into
--            app_data.canonical_events.
--
-- This is the write surface for the V11 AI briefing feed.
-- Apps call this after key actions:
--   Service  → 'defect.created', 'wo.closed', 'report.submitted'
--   Quotes   → 'quote.created', 'quote.accepted', 'quote.sent'
--   Cards    → 'card.issued', 'licence.expiring'
--   Field    → 'shift.started', 'staff.onboarded'
--
-- The function is intentionally simple: no duplicate detection, no schema
-- validation on payload. Callers are trusted (service-role). Schema
-- evolution happens via payload JSONB — no column migrations needed.

CREATE OR REPLACE FUNCTION public.eq_write_canonical_event(
  p_tenant_id   uuid,
  p_app_source  text,
  p_event       text,
  p_payload     jsonb        DEFAULT '{}'::jsonb,
  p_occurred_at timestamptz  DEFAULT now()
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'app_data', 'public'
AS $$
  INSERT INTO app_data.canonical_events (tenant_id, app_source, event, payload, occurred_at)
  VALUES (p_tenant_id, p_app_source, p_event, p_payload, p_occurred_at);
$$;

REVOKE ALL ON FUNCTION public.eq_write_canonical_event(uuid, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eq_write_canonical_event(uuid, text, text, jsonb, timestamptz) TO service_role;

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0013_write_canonical_event_rpc', NULL)
  ON CONFLICT (name) DO NOTHING;
