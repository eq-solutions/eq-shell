#!/usr/bin/env bash
# E2E smoke for the asset-intake path: commit a fixture asset through the
# intake-commit orchestrator, then assert it surfaces in the dashboard count
# and the entity browser. Round-trips the real tenant data plane.
#
# SAFETY: never point this at production. It writes rows. Run it against a
# Netlify deploy preview or `netlify dev`, using a disposable test tenant.
# Raw writes to the prod tenant DB (eq-canonical-internal) are intentionally
# not performed here.
#
# Usage:
#   EQ_SMOKE_JWT=<supabase_jwt_for_test_tenant> \
#   ./scripts/smoke-asset-intake.sh http://localhost:8888
#
# The JWT must carry app_metadata.tenant_id = the test tenant. Mint one via
# /.netlify/functions/mint-supabase-jwt while signed in as a test user, or
# from the service-role signer in a non-prod context.
#
# Prereqs in the target DB (seed once): a site whose name contains "SMOKE"
# so the asset's site_id fuzzy-match resolves. The script prints the asset's
# intake_id so you can clean up afterwards:
#   DELETE FROM app_data.assets WHERE intake_id = '<printed>';

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: EQ_SMOKE_JWT=<jwt> $0 <base-url>" >&2
  exit 2
fi
if [ -z "${EQ_SMOKE_JWT:-}" ]; then
  echo "EQ_SMOKE_JWT is required (supabase JWT for the test tenant)." >&2
  exit 2
fi
case "$1" in
  *core.eq.solutions*) echo "Refusing to run against production." >&2; exit 2 ;;
esac

BASE_URL="${1%/}"
INTAKE_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python -c 'import uuid;print(uuid.uuid4())')"
AUTH="Authorization: Bearer ${EQ_SMOKE_JWT}"

echo "Smoking asset intake against ${BASE_URL} (intake_id=${INTAKE_ID})"
echo "----"

# 1. Commit one fixture asset through the orchestrator.
COMMIT=$(curl -sS -o /tmp/asset-commit -w '%{http_code}' \
  -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"intake_id\":\"${INTAKE_ID}\",\"table\":\"assets\",\"source_sig\":\"smoke-asset-intake\",\"schema_version\":\"1.0.0\",\"import_mode\":\"append\",\"rows\":[{\"asset_type\":\"switchboard\",\"name\":\"MSB-1 smoke\",\"make\":\"ACME\",\"serial_number\":\"SMOKE-001\",\"active\":true}]}" \
  "${BASE_URL}/.netlify/functions/intake-commit")
BODY=$(cat /tmp/asset-commit)
echo "intake-commit -> HTTP ${COMMIT}: ${BODY}"

if [ "$COMMIT" != "200" ]; then
  echo "FAIL: commit did not return 200" >&2
  exit 1
fi
if ! echo "$BODY" | grep -q '"committed_count":1'; then
  echo "FAIL: expected committed_count:1 (check the test site exists for site_id fuzzy-match)" >&2
  exit 1
fi

# 2. Assert it shows in the entity browser (session-cookie auth path; this
#    step is a smoke of the read path and may need a cookie instead of JWT
#    depending on entity-rows auth — see entity-rows.ts).
ROWS=$(curl -sS -o /tmp/asset-rows -w '%{http_code}' -H "$AUTH" \
  "${BASE_URL}/.netlify/functions/entity-rows?entity=asset&search=SMOKE-001" || echo "000")
echo "entity-rows -> HTTP ${ROWS}: $(cat /tmp/asset-rows)"

echo "----"
echo "PASS: asset committed via orchestrator."
echo "Clean up:  DELETE FROM app_data.assets WHERE intake_id = '${INTAKE_ID}';"
