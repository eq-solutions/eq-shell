-- sks_overlay_fn_revoke.sql   TARGET: ehowgjardagevnrluult (LIVE SKS)   GATE: 🔒 Track-B-adjacent
--
-- FINDING (advisor lint 0028, 2026-05-30): the 5 sks_* overlay functions are
-- SECURITY DEFINER and carry anon + authenticated EXECUTE. Verified live: all 5
-- are `RETURNS trigger` (prosecdef=true) — i.e. INSTEAD-OF trigger fns on the
-- sks_contacts / sks_contact_links views. Calling a trigger fn directly via
-- /rest/v1/rpc errors ("trigger functions can only be called as triggers"), so
-- practical exploitability is low — but the grant is still wrong.
--
-- SAFE: triggers fire as the table owner regardless of EXECUTE grant, and EQ
-- Quotes writes via the service-role key, so revoking anon/authenticated does
-- NOT affect the Quotes contacts flow. Reversible.
--
-- NOTE: this is part of the sks_* silo (Track B). It can ship standalone as a
-- pure hardening revoke, or fold into the Track B silo retirement (B3).

BEGIN;

REVOKE EXECUTE ON FUNCTION public._sks_contacts_insert_fn()       FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sks_contacts_update_fn()       FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sks_contacts_delete_fn()       FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sks_contact_links_insert_fn()  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sks_contact_links_delete_fn()  FROM anon, authenticated, PUBLIC;

COMMIT;
