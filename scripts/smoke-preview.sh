#!/usr/bin/env bash
# Smoke a Netlify deploy preview's critical eq-shell endpoints.
#
# Usage:
#   ./scripts/smoke-preview.sh https://deploy-preview-15--eq-shell.netlify.app
#
# Returns 0 if every endpoint returned a non-5xx with the expected
# unauthenticated/empty-body status code. Returns 1 on the first 5xx,
# missing endpoint, or unexpected non-error status. Specifically catches
# the "Server misconfigured — missing <VAR>" 500 that signals a Deploy
# Preview environment-variable scoping bug — see
# docs/runbooks/deploy-preview-env.md.
#
# Why this exists: PR #15 (2026-05-23) discovered that server-side env
# vars (SUPABASE_JWT_SECRET, EQ_SECRET_SALT, etc.) were scoped to the
# Production context only, so every PR's deploy preview returned 500 on
# /shell-login the first time anyone tried to log in. This script catches
# that class of misconfiguration without anyone having to click through
# the UI.
#
# This is a black-box smoke test — it doesn't authenticate, doesn't touch
# the canonical DB, doesn't write anything. Each endpoint is hit once with
# the smallest valid request that should produce a non-5xx response.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <preview-url>" >&2
  echo "Example: $0 https://deploy-preview-15--eq-shell.netlify.app" >&2
  exit 2
fi

BASE_URL="${1%/}"
FAIL_COUNT=0

# Each row: METHOD PATH ACCEPTED_STATUSES DESCRIPTION
# - verify-shell-session with no cookie:        401 expected
# - shell-login with empty body:                400 expected (malformed)
#
# Each of these exercises the env-var checks at the top of the function:
# hasSecretSalt(), hasSupabaseJwtSecret(), getServiceClient(). If any
# var is missing, the function 500s with a "Server misconfigured" body
# BEFORE reaching the auth check — so any 4xx means env is fine.
declare -a CHECKS=(
  "GET   /.netlify/functions/verify-shell-session                                                        401      unauthenticated"
  "POST  /.netlify/functions/shell-login                                                                 400      empty-body"
)

printf '%s\n' "Smoking ${BASE_URL}"
printf '%s\n' "----"

for row in "${CHECKS[@]}"; do
  read -r METHOD PATHSPEC ACCEPTED DESC <<< "$row"
  URL="${BASE_URL}${PATHSPEC}"

  if [ "$METHOD" = "POST" ]; then
    RESPONSE=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' -d '{}' \
      "$URL" || echo "000")
  else
    RESPONSE=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' \
      -X "$METHOD" "$URL" || echo "000")
  fi

  BODY=$(cat /tmp/smoke-body 2>/dev/null || echo "")

  # ACCEPTED is a `|`-separated list (e.g. "400|401") so endpoints whose
  # status legitimately changes across PRs don't trip false positives.
  if echo "|$ACCEPTED|" | grep -qE "\|${RESPONSE}\|"; then
    printf 'PASS  %-50s %s  (%s)\n' "$PATHSPEC" "$RESPONSE" "$DESC"
  elif [ "$RESPONSE" -ge 500 ] 2>/dev/null; then
    printf 'FAIL  %-50s %s  %s\n' "$PATHSPEC" "$RESPONSE" "$BODY"
    if echo "$BODY" | grep -qE 'Server misconfigured|missing [A-Z_]+'; then
      printf '      ^-- looks like a missing env var on the Deploy Previews context.\n'
      printf '          See docs/runbooks/deploy-preview-env.md.\n'
    fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    printf 'WARN  %-50s %s  (accepted %s — %s)  %s\n' "$PATHSPEC" "$RESPONSE" "$ACCEPTED" "$DESC" "$BODY"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

printf '%s\n' "----"

if [ "$FAIL_COUNT" -eq 0 ]; then
  printf 'PASS  all %d endpoints returned the expected non-5xx status\n' "${#CHECKS[@]}"
  exit 0
else
  printf 'FAIL  %d endpoint(s) failed — preview is not ready for end-to-end smoke\n' "$FAIL_COUNT"
  exit 1
fi
