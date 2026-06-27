# canonical-api key hardening (H-07)

## Problem
The gateway (`netlify/functions/canonical-api.ts`) authenticates each consuming app
with a long-lived bearer key (`CANONICAL_API_KEY_{CARDS,SERVICE,QUOTES,SHELL,FIELD}`).
The platform apps legitimately serve *all* tenants, so the key's tenant scope is `['*']`
by design — narrowing it would break them. The real risk is **blast radius**: a leaked
key can read every tenant's data until the leak is noticed.

## Phase 1 — blast-radius cap  ✅ DONE (`79ec3fe`)
A generous per-`(app, tenant)` request ceiling (6000 / 5 min) via
`check_and_increment_rate_limit`, returning `429` above it. Far above legit
server-to-server traffic; **fail-open** on a limiter error so a control-plane hiccup
never takes the gateway down. Caps bulk exfiltration without touching the legitimate
multi-tenant scope. *Tune the ceiling once real traffic is observed.*

## Phase 2 — short-lived scoped tokens (the durable fix; the leaders' pattern)
Replace the long-lived keys with a per-request **short-lived token** scoped to
`(app, tenant, resources)`, reusing the existing `token-exchange` mint pattern. A leaked
credential is then useless in ~60s and is inherently scoped to a single tenant — the
AWS-STS / Vault-dynamic-secrets model.

**Backward-compatible rollout (no big-bang, nothing breaks):**
1. `canonical-api` accepts **both** a long-lived key and a short-lived token (verify
   token first, fall back to the key). `authenticateCaller` returns the app plus the
   token's tenant/resource scope when a token is presented.
2. Add a mint path (extend `token-exchange` or a new `mint-canonical-token`): given a
   verified caller, mint a 60s HS256 token with `{ app, tenant, resources, exp }`.
3. Migrate consumers **one at a time** — eq-cards, eq-solves-service, eq-quotes,
   eq-shell-internal — each mints a token per request and sends it instead of the static
   key. Each is a separate-repo PR; verify the app still works, then move to the next.
4. Once every consumer sends tokens, **retire** `CANONICAL_API_KEY_*` (revoke + delete).

Per-tenant scoping falls out for free: the token is minted for the exact tenant the
request is for, so even a platform app's token only ever opens one tenant.

## Adjacent — confirm, not code
- **Confirm `CANONICAL_API_KEY_CARDS` is not extractable from the shipped eq-cards web
  bundle.** A browser-extractable all-tenant key would be the real exposure; if present,
  move that read server-side (the Phase-0 Field-proxy pattern).
- Keep the resource ACLs (`APP_RESOURCE_READ`/`WRITE`) tight — they already enforce
  least-privilege per app (cards can't read assets, quotes can't read staff, etc.).

## Where this leaves us
Phase 1 is the safe immediate backstop and is in. Phase 2 is a coordinated cross-repo
migration — schedule it when ready. It's the move from "one long-lived key that opens
every company" to "a short-lived token that opens one company for 60 seconds," which is
exactly how the cloud-security leaders manage service credentials.
