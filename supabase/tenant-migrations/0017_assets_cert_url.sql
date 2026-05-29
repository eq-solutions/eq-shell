-- Migration: 0017_assets_cert_url
-- Target:    Per-tenant data plane
-- Purpose:   Add a nullable cert_url column to app_data.assets so plant &
--            equipment items (meters, test gear, etc.) can carry a link to
--            their current calibration / compliance certificate.
--
--            Display-only in v0 — the Plant & Equipment shell module reads
--            it through the existing eq_browse_entity RPC, which selects
--            to_jsonb(t.*) and therefore surfaces the new column with no RPC
--            change required.
--
-- Runner:    scripts/migrate-tenants.mjs applies every file in name order,
--            skipping ones already in app_data._eq_migrations.

BEGIN;

ALTER TABLE app_data.assets
  ADD COLUMN IF NOT EXISTS cert_url text;

COMMENT ON COLUMN app_data.assets.cert_url IS
  'Link to the current calibration / compliance certificate for this item. Nullable. Added 0017.';

INSERT INTO app_data._eq_migrations(name, checksum) VALUES ('0017_assets_cert_url', NULL)
  ON CONFLICT (name) DO NOTHING;

COMMIT;
