-- Migration: 0123_quote_hard_delete
-- Target:    Per-tenant data plane
-- Purpose:   Permanent delete for EQ Ops quotes. Archive (eq_trash_quote) stays
--            the recoverable soft-delete; this removes a quote for good. Every
--            app_data.quote child FK is ON DELETE CASCADE (line items, status
--            history, job notes, attachments, email outbox, share links), so a
--            single DELETE on the parent clears the whole record. Tenant-scoped
--            via the JWT app_metadata tenant_id, same posture as eq_trash_quote.

CREATE OR REPLACE FUNCTION public.eq_delete_quote(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_data, public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  DELETE FROM app_data.quote
  WHERE quote_id = p_quote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote not found or access denied';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eq_delete_quote(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eq_delete_quote(uuid) TO authenticated;
