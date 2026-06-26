# Phase 0 — EQ Field canonical-read proxy (close V1/V2 anon PII)

**Repo for implementation:** `eq-field` (separate repo, separate PR + deploy). This
spec lives in eq-shell because the sprint + the paired jvkn migration do. **No
cross-repo edits were made from the eq-shell session — this is a hand-off spec.**

## Why
Two jvkn `SECURITY DEFINER` functions return worker PII and are callable with the
**public anon key**:
- **V1** `eq_get_org_licences(p_org_id)` → worker name/email/phone + licence number.
- **V2** `eq_field_get_worker_summary(p_worker_id, p_org_id)` → emergency contact +
  right-to-work status.

EQ Field's **browser** calls both directly with `CANONICAL_ANON_KEY`
(`scripts/people.js` `_fetchCanonLicences` ~1098, `_fetchWorkerSummary` ~1151), so a
blind `REVOKE … FROM anon` is a production outage (blanks the SKS "Cards Record"
panel + licence list). This spec moves the read **server-side** into a Field Netlify
function that authenticates the Field session and derives the org server-side; the
jvkn functions then become **service-role-only**.

## Security invariant (the whole point)
The client must NOT choose which org's data it reads. Today `people.js` sends
`p_org_id = TENANT.CANON_ORG_UUID` (client-controlled — an attacker can swap it). The
proxy **discards any client-supplied org id** and derives it from the verified session
/ request origin. A caller can only ever read their own org.

## New Field Netlify function — `netlify/functions/canon-read.js`
Mirror `eq-service-sites.js` (verify token → server-derived scope → shaped read).

1. **POST only.** Read `event.headers['x-eq-token']` → `verifyToken()` (the existing
   HMAC primitive: `send-email.js:64` / `verify-pin.js:286`, key = `EQ_SECRET_SALT`,
   already set on Field). Reject 401 if null/expired. The verified session carries
   `{ name, role, eq_role?, tenant_slug? }`.
2. **Derive tenant slug server-side:** `slug = session.tenant_slug || tenantFromOrigin(event)`
   (`verify-pin.js:199-206`). Field is single-tenant per origin
   (`eq-solves-field.netlify.app`→`eq`, `sks-nsw-labour.netlify.app`→`sks`), so origin
   is a sound server signal. Reject 400 if no slug resolves.
3. **Resolve the jvkn org id for that slug server-side.** Reuse the same resolution the
   browser does in `_loadCanonicalConfig` (jvkn `organisations` lookup by hostname/slug),
   but server-side via the service-role client. **Do NOT read any org id from the request
   body.** (Cache per cold-start if desired.)
4. **Service-role client to jvkn:** new env var **`CANONICAL_SERVICE_ROLE_KEY`** (jvkn
   service-role) + `CANONICAL_URL` (`https://jvknxcmbtrfnxfrwfimn.supabase.co`).
   Server-only; never sent to the browser.
5. **Dispatch on `body.action`:**
   - `'org-licences'` → `rpc('eq_get_org_licences', { p_org_id: <derived> })` → return
     rows unchanged.
   - `'worker-summary'` → `rpc('eq_field_get_worker_summary', { p_worker_id: body.worker_id, p_org_id: <derived> })`
     → return the row. `worker_id` is client-supplied but **safe**: the forced
     `p_org_id` scopes it — the function only returns a worker who is an active member
     of the derived org, so a caller can't read workers outside their own org.
6. **Return the SAME row shapes** `people.js` already renders, so `_licencesForPerson`,
   the licence renderer, and `_loadCanonicalSummary` are untouched.

## `scripts/people.js` cutover
- `_fetchCanonLicences` (~1098): replace `fetch(CANONICAL_URL + '/rest/v1/rpc/eq_get_org_licences', {anon headers, body:{p_org_id}})`
  with `POST /.netlify/functions/canon-read`, headers
  `{ 'Content-Type':'application/json', 'x-eq-token': <eq_session_token> }`, body
  `{ action:'org-licences' }` — **no org id**. Keep the per-session cache.
- `_fetchWorkerSummary` (~1151): `POST /.netlify/functions/canon-read`, body
  `{ action:'worker-summary', worker_id }` — **no org id**.
- The session token is read the same way other Field calls read it:
  `sessionStorage.getItem('eq_session_token') || localStorage.getItem('eq_agent_token')`.
- Drop `CANONICAL_ANON_KEY` from these two paths.

## Paired jvkn migration (eq-shell — already drafted)
`supabase/migrations/2026_06_27_revoke_anon_pii_functions.sql`:
`REVOKE EXECUTE … FROM anon, authenticated` on both functions (service_role retains).
Authorization now lives entirely in `canon-read.js`; the SECURITY DEFINER bodies are
unchanged. **Apply ONLY after the proxy + cutover are deployed and verified.**

## Sequencing (load-bearing — reversing it is an outage)
1. Ship `canon-read.js` + `people.js` cutover in eq-field; deploy to field.eq.solutions.
2. Verify: SKS Cards Record panel + licence list still render, and the browser makes
   **no** anon RPC to jvkn (network shows only `/.netlify/functions/canon-read`).
3. Confirm no other anon/authenticated caller of the two RPCs (eq-cards, other Field
   paths) — sprint task 0.4.
4. Apply the jvkn revoke migration. Re-verify the panel.

## Royce action items
- **Add `CANONICAL_SERVICE_ROLE_KEY`** (the jvkn service-role key) to the EQ Field
  Netlify site env (Production/Functions scope, server-only). This is Field's first
  jvkn service-role key; it's confined to `canon-read.js`. Consistent with the house
  rule "service-role Supabase client stays inside Netlify functions."
- **Apply mechanism** for the jvkn revoke migration (governed run vs Supabase-MCP
  hotfix-then-commit, PR #450/#451 precedent) — your call.

## Alternative considered (no new service-role key)
The proxy could instead mint a short-lived jvkn **authenticated** JWT — Field already
holds `SUPABASE_JWT_SECRET` and mints data-plane JWTs (`_shared/leave-canonical.js`
`mintCanonicalJwt`, `verify-pin.js` `mint-data-jwt`) — and call the RPCs as
`authenticated`, keeping them authenticated-callable with an added **in-body caller
guard**. Reuses an existing secret (no new key) but adds guard complexity on the jvkn
side (and a tenant_id↔org_id mapping) plus a broader callable surface. The service-role
proxy above keeps the jvkn side bulletproof (service-role-only, no guard logic to get
wrong). Say the word to switch to the JWT variant — it changes only step 4 of the
function and makes the migration `REVOKE … FROM anon` + add a caller guard (keep
`authenticated`).
