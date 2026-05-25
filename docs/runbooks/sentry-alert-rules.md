# Sentry alert rules — eq-shell

Documents the four operational alert rules wired via `scripts/setup-sentry-alerts.mjs`.

---

## One-time setup

```bash
# 1. Create a Sentry internal integration token
#    https://eq-solutions.sentry.io/settings/auth-tokens/
#    Required scopes: project:write, project:read, alerts:write, alerts:read

# 2. Apply the rules (idempotent — safe to re-run)
SENTRY_AUTH_TOKEN=sntrys_xxx node scripts/setup-sentry-alerts.mjs

# 3. Verify at
#    https://eq-solutions.sentry.io/alerts/rules/?project=eq-shell
```

Alerts fire to **dev@eq.solutions**.

---

## The four rules

### 1 · 5xx error spike

**Trigger:** ≥ 5 events with `http.status_code >= 500` in any 1-hour window on production.

**Why it matters:** A single 500 is normal (misconfigured request, stale session); five in an hour means a function is broken for real users.

**Likely causes:**
- Supabase service outage (canonical or tenant DB)
- `TENANT_ROUTING_MASTER_KEY` mismatch (decryption fails on every call)
- Netlify function cold-start OOM

---

### 2 · Auth failure spike

**Trigger:** ≥ 10 auth-tagged events in 10 minutes on production.

**Why it matters:** A spike here means the login/session flow is broken — users can't sign in or are being silently booted.

**Likely causes:**
- `EQ_SECRET_SALT` rotated on one deploy but not the others — tokens from the old key fail verify
- `SUPABASE_JWT_SECRET` changed on eq-canonical without updating eq-shell
- Cookie SameSite / Secure attribute mismatch after a domain change

---

### 3 · RLS / permission denied

**Trigger:** Any event whose message contains "permission denied" (first seen OR regression).

**Why it matters:** In normal operation, Supabase RLS policies return empty results — they never throw. A "permission denied" that reaches Sentry means a policy threw rather than filtered, and that error reached the user.

**Likely causes:**
- A new RLS policy uses `RAISE EXCEPTION` instead of filtering with `USING (false)`
- A function was migrated to a new schema but the `GRANT` wasn't updated
- Service-role key wasn't set correctly (shouldn't be possible — getServiceClient() fail-louds on startup)

---

### 4 · JWT / token mint failure

**Trigger:** ≥ 3 events whose message contains "mint" in any 5-minute window on production.

**Why it matters:** The iframe handoff for Cards and Field depends on minting a fresh token on every page load. Three failures in 5 minutes means users are landing on blank iframes.

**Likely causes:**
- Cards iframe: `mint-cards-iframe-token` returning non-2xx (user's session expired, function misconfigured)
- Field iframe: `mint-iframe-token` rejecting a tenant slug not in the allow-list
- Supabase service call inside the mint function failing

---

## Modifying rules

Edit `scripts/setup-sentry-alerts.mjs` → `ISSUE_ALERT_RULES` array → re-run the script. Changes are applied idempotently (old rule deleted, new rule created under the same name).

## Related

- `scripts/setup-sentry-alerts.mjs` — the apply script
- `netlify/functions/_shared/sentry.ts` — `withSentry` wrapper used by all functions
- `SECURITY-PATTERNS.md §1` — fail-loud on missing secrets (Sentry captures these)
- Sentry dashboard: https://eq-solutions.sentry.io/issues/?project=eq-shell
