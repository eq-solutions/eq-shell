# EQ Shell — Security Hardening Sprint (master program)

The definitive hardening plan for putting the EQ auth hub in front of many more
users and tenants. Supersedes the narrow [privacy-hardening sprint](sprint-privacy-hardening.md)
as the program-level view; that doc + the [Phase 0 proxy spec](phase0-field-canonical-proxy-spec.md)
remain the detailed sub-plans. Built from two audits (2026-06-26 exploit-focused +
2026-06-27 scaling/abuse/privacy/secrets/authz sweep).

**Nothing here deploys without Royce.** Auth/data changes are approval-gated; jvkn
DDL goes via the governed path. This is the plan.

**Built so far** (branch `claude/determined-edison-d6f176`, build/`node`-verified, NOT
deployed): P0 — H-01/H-03/H-04/H-05 (`e9d6732`) · keystone **H-06** drift CHECK
(`d19821c`) · H-11 + H-20 + H-22 (`756fd9c`) · H-16 (resend) + H-17a (`fae0c56`).
Earlier in the arc: V3 (`e00d2df`), V4 + P1 (`8d6d77c`), Phase 0 spec + revoke migration
(`dc2ee17`). **Remaining:** H-12/H-13/H-15/H-17b/H-18/H-19/H-21 (buildable here),
H-16 (remaining log sites), the eq-field specs (H-00 JWT variant, 1.2), and the three
decision-gated items (H-07/H-08/H-14/H-23).

---

## 0. Steelman — why this is the work, and what's already strong

**The case.** EQ Shell is the single auth hub for the whole suite, holding the session
cookie and minting the tokens Cards/Field/Service trust. It guards two *separate
entities'* (EQ + SKS) most sensitive data: worker PII, ID-document photos, immigration
status, emergency contacts, customer books, credentials. Scaling the user base does two
things at once — it multiplies the PII at risk and it enlarges the population of
*authenticated low-privilege users*, which both audits found to be the real attack
surface. The architecture is the moat; that makes security a product feature, not a
chore. This justifies a program, not point fixes.

**What's already strong (verified, not assumed) — so we harden, not rebuild:**
- **Crypto primitives are sound.** Signing algs are hardcoded (no `alg=none` / no
  header-selected alg / no RS-HS confusion), every verify enforces signature + `exp` +
  `kind`/`aud`, HMAC compares are constant-time, all tokens/codes/nonces are CSPRNG,
  per-tenant data-plane keys are AES-256-GCM encrypted at rest.
- **Mass-assignment is clean across every body-accepting writer** — `tenant_id`/`role`/
  `is_platform_admin`/`user_id` are derived server-side or allow-listed; no self-serve
  path can set `is_platform_admin` (hard-`false`), invites can't target `platform_admin`,
  cross-tenant `tenant_id` is re-validated against memberships.
- **The Netlify authz layer is now consistent** post-V4 — session + tenant-scope +
  per-action `can()` across entity/admin/intake/cards/reports. The sweep confirmed
  **no second `crm-write` exists** in the function layer.
- **Identity binding on the doors is correct** — OTP/magic-link verify the GoTrue token's
  email/phone equals the submitted one; forced TOTP is shared across all three login
  paths; invite/reset tokens are `randomBytes(32)` + SHA-256-hashed at rest, single-use,
  expiring.

The gaps below are **scaling-abuse resistance** and **privacy-by-design debt** — plus
two SECDEF holes and one systemic gate blind spot. Most P0s are one-liners.

---

## 1. Status carried in

| Finding | Status |
|---|---|
| V3 token-exchange cross-tenant mint | ✅ fixed `e00d2df` |
| V4 crm-write missing authz | ✅ fixed `8d6d77c` |
| P1 private-licence leak | ✅ fixed `8d6d77c` |
| V1/V2 anon SECDEF reads (eq_get_org_licences / eq_field_get_worker_summary) | 🚧 Phase 0 spec + revoke migration committed `dc2ee17`; **see H-00** |

### H-00 — Reconsider Phase 0: use the JWT-mint variant, not a jvkn service-role key
**Why (new, load-bearing):** the chosen "service-role proxy" requires
`CANONICAL_SERVICE_ROLE_KEY` — the **jvkn control-plane** service-role key, which owns
*every* tenant's canonical records across **both entities** — to be added to the **EQ
Field / SKS** Netlify deploy. That collides with the non-negotiable global rule *"SKS and
EQ are separate entities — never mix credentials."* The proxy spec's documented
alternative — mint a short-lived jvkn **authenticated** JWT from `SUPABASE_JWT_SECRET`
(which Field already holds and already uses for `mint-data-jwt`), keep the two RPCs
`authenticated`-callable, and add an in-body caller guard — closes the same anon hole
**without** a new full-power cross-entity key. **Recommendation: switch Phase 0 to the
JWT variant.** It changes only step 4 of `canon-read.js` and makes the migration
`REVOKE … FROM anon` + add a caller guard (keep `authenticated`), instead of revoking
both. Effort: same. *Your call to confirm the switch.*

---

## 2. Threat model (scaling lens)

| Actor | Why scaling makes it worse | Findings |
|---|---|---|
| **Unauthenticated internet** | Public doors (login, OTP, quote portal, provision links) face everyone | V1/V2, H-04, H-09, H-13, H-19 |
| **Low-priv authenticated user** (every new worker) | Population grows with onboarding; direct PostgREST/RPC reach bypasses the UI | **H-01**, H-05, H-23 |
| **Rogue / compromised manager token** | More tenants → more manager tokens to leak/abuse | H-07, H-08, H-12, abuse-F15 |
| **Leaked app key / deploy env** | More integrations & deploys holding shared secrets | H-06-scope, H-15, H-16-keys, H-00 |
| **Cross-entity (EQ↔SKS)** | The boundary that must never blur | H-00, H-10, canonical scoping |

---

## 3. Backlog (prioritized)

### P0 — Active exploits, mostly one-liners (this week)

| ID | Finding | Sev / Conf | Fix | Effort | Acceptance |
|---|---|---|---|---|---|
| **H-01** | `check_and_increment_rate_limit` has EXECUTE for `authenticated` → any logged-in user locks any victim out of login/2FA for up to a year (`p_lockout_secs` caller-set); victim can't self-unlock. **Confirmed live 2026-06-27 (anon✗ / authed✓).** | High / 9 | `REVOKE EXECUTE … FROM authenticated, anon` (only ever called via service-role inside functions) | S | authed user gets `permission denied` on the RPC; in-function rate-limiting unaffected |
| **H-03** | `shell-provision-tenant` checks `used_at` but not `expires_at` → a leaked provision link stands up a tenant + manager account forever | Med / 9 | add `.gte('expires_at', now)` to lookup+consume; generic "invalid or expired" | S | expired token → rejected |
| **H-04** | Public phone-OTP send has no `shouldCreateUser:false` → unauth attacker provisions junk `auth.users` + pumps SMS (toll fraud) to arbitrary numbers | High / 8 | `shouldCreateUser:false` at `LoginPage.tsx:195`; confirm/tighten Supabase Auth SMS limits | S | OTP to an unknown number does not create a user; **verify SMS provider limits live** |
| **H-05** | `cards-staff-matches` worker fetch filtered only by `?user_id` (not tenant) on the global `public.workers` → manager in tenant A reads any other tenant's worker name/phone/email by UUID | Med / 8 | constrain the worker fetch to the caller's org before returning PII | S | cross-tenant user_id → no PII returned |

### P1 — Data-harvest blast radius + the systemic guard

| ID | Finding | Sev | Fix | Effort |
|---|---|---|---|---|
| **H-06** | **Drift-gate blind spot:** `check-tenant-drift.mjs` inspects *table* grants only — function EXECUTE grants are invisible (how V1/V2/H-02/H-09 slipped past) | High / 10 | **Add CHECK 6 — function-EXECUTE invariant:** fail on any SECURITY DEFINER function reachable by `anon`/`authenticated` not on an explicit allow-list; also assert `pg_default_acl` (functions) carries no anon/authenticated, and add sequence-grant coverage. **This is the keystone — it converts the whole SECDEF-anon class from "manual catch" to "every run."** | M |
| **H-07** | `canonical-api` app keys hardcoded `['*']` (cards/service/quotes/shell) + caller-chosen `?tenant=` + no per-key rate cap → one leaked app key dumps all-tenant PII | High | replace `['*']` with real per-app/per-tenant allow-lists (`shell_control.app_tenant_scope`); per-key rate cap; confirm `CANONICAL_API_KEY_CARDS` isn't in the shipped web bundle | M |
| **H-08** | `canonical-api` `staff` projection returns DOB + home address + emergency contact + dob_day/month to **every** reader app by default (more than any renders) | High / 9 | drop sensitive fields from the default projection; `?include=sensitive` gated by ACL (pattern already anticipated in-file) | M |
| **H-09** | `eq_cards_submit_access_request` (worker-initiated QR-join): live grant is **correct** (anon✗ / authed✓, confirmed) and the writer is `auth.uid()`-bound — but the migration omitted an explicit `REVOKE/GRANT` (relied on the default) and there's no rate limit → authenticated request-spam to discoverable orgs + an org-enumeration oracle | Low (hardening) | governed `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated` for hygiene; per-IP/per-actor throttle | S |
| **H-10** | `licence-photos` bucket tenant-isolation is a **manual, unverified dashboard policy** — no migration, invisible to drift CI; if absent/wrong, cross-entity ID-photo reads | High / 8 | **verify live first** (`public=false`, tenant-folder-prefix RLS, no anon, upload paths carry the prefix); then codify as a governed migration + drift assertion | S verify / M codify |
| **H-11** | Invite / PIN-reset / quote-portal **tokens in GET query strings** → browser history, `Referer`, and Sentry (`sentry.ts` attaches `req.url`) | Med / 8 | move tokens to URL fragment + POST in body (pattern already at `App.tsx:235`); scrub `token`/`sh` from Sentry `extra.url` | S–M |
| **H-12** | No rate limit on `shell-request-pin-reset` (email-bomb + timing oracle), `create/resend-worker-invite`, `invite-users-batch`; login doors key IP-only or identity-only (sprayable) | Med | `check_and_increment_rate_limit` on each sender (keyed recipient + actor/IP); composite IP **and** identity on login doors; `resend` refuses when an active unclaimed invite exists | S–M |
| **H-13** | Enumeration oracles: `quote-portal`/`quote-accept` distinct `tenant_not_found` vs `link_not_found` (unauth, no throttle) leak the live tenant list; `magic-link` `no-account` | Med | collapse to generic 404 + per-IP throttle | S |

### P2 — Privacy-by-design + key isolation

| ID | Finding | Sev | Fix | Effort |
|---|---|---|---|---|
| **H-14** | **No erasure/anonymization path anywhere.** Worker delete only flips `active=false` — names, licence numbers, and **ID photos persist forever**; no tenant-offboarding purge | High / 9 (compliance) | erasure routine: purge `licence-photos` prefix + soft-delete canonical `licences` + anonymize the ehow staff mirror; tenant-offboarding purge; documented retention policy per data class | L |
| **H-15** | `EQ_SECRET_SALT` shared across 4 deploys (per-consumer isolation built but unset) → one leaked deploy forges session cookies suite-wide; only `session` has a `_NEXT` rotation key | Med | activate `EQ_SESSION_SALT`/`EQ_QUOTES_HANDOFF_KEY` etc.; add `_NEXT` verify-fallback for field/quotes; add rotation runbooks for `SUPABASE_JWT_SECRET` + tenant JWT secrets. **Verify live which vars are set.** | M |
| **H-16** | Email addresses logged at 6 sites (resend, scheduler ×2, phone-otp, backfill, invite-batch) | Med | log `user_id`/`worker_id` (all in scope) instead of email; hash/message-id in `email/resend.ts` | S |
| **H-17** | Licence number baked into export ZIP filenames (propagates outside the CSV); `FieldRosterPage` renders phone/email with no `<Gate>`; roster endpoints over-return full email set | Med–Low | use `licence_id[:8]` in filenames (already computed); wrap roster page in `<Gate perm="field.view">`; `?fields=` lean roster default | S–M |
| **H-18** | `ENFORCE_IFRAME_ORIGIN` report-only in prod → `SameSite=Lax` + `.eq.solutions` cookie lets a sibling-subdomain page (or XSS) confused-deputy POST to mint endpoints; `token-exchange` doesn't call `checkShellOrigin` | Med | after reviewing report-only logs, set `ENFORCE_IFRAME_ORIGIN=true`; add `checkShellOrigin` to `token-exchange.ts`. **Verify live env.** | S |

### P3 — Defense-in-depth cleanups

| ID | Finding | Fix | Effort |
|---|---|---|---|
| **H-19** | 7-day session cookie has no per-session revocation (no `jti`) | add `jti` to `SessionPayload` + `eq_is_session_revoked` check in `verify-shell-session`; make `select-tenant` selection token single-use | M |
| **H-20** | `verifySupabaseJwt` doesn't re-assert `alg`/`typ` inside the verifier (latent footgun); TOTP code compared with `===` | add `alg==='HS256'` assertion to both Shell + Field verifiers; constant-time TOTP compare | S |
| **H-21** | Dead Field-HMAC signing path (`signShellToken`) keeps `EQ_SECRET_SALT` alive as a handoff signer | after H-15 cutover, delete it + retire `EQ_FIELD_HANDOFF_KEY` | S |
| **H-22** | `worker_invites.token` plaintext at rest + echoed by `list-worker-invites` (Shell `user_invites` is hashed — inconsistent); `worker_phone` string-interpolated into a PostgREST `.or()` | hash worker-invite tokens at rest + stop echoing (separate "regenerate link" action); sanitize `worker_phone` to `[0-9+]` and add a tenant predicate | S–M |
| **H-02** | *(corrected from P0 — latent, not live.)* Migration `2026_06_16`'s 2-arg `eq_cards_claim_invite(p_token,p_user_id)` grants `authenticated` with no `auth.uid()` check, but is **committed-and-unapplied** (live is the safe 1-arg). If ever applied → arbitrary-user provisioning. Also a migration↔live **drift** to reconcile | withdraw or guard the 2-arg migration before it ships; revoke the harmless anon grant on the live 1-arg | S |
| **H-23** | CRM reads (`crm-customers`, `entity-rows` customer/contact/site) open to any authed user incl. `labour_hire` — the read sibling of V4 | **Decide:** gate on `entity.view` (recommended, matches the write side) **or** ratify-and-document as intentional open read | S |

---

## 4. Live verification

**Confirmed against jvkn 2026-06-27** (`has_function_privilege` + `pg_get_functiondef`):

| Function (live signature) | secdef | anon | authed | Verdict |
|---|---|---|---|---|
| `check_and_increment_rate_limit(text,int,int,int)` | ✓ | ✗ | **✓** | **H-01 confirmed** — lockout reachable; `clear_rate_limit` authed=✗ (no self-unlock) |
| `eq_get_org_licences(uuid)` | ✓ | **✓** | ✓ | **V1 confirmed** still anon (revoke not applied) |
| `eq_field_get_worker_summary(uuid,uuid)` | ✓ | **✓** | ✓ | **V2 confirmed** still anon |
| `eq_cards_claim_invite(text)` | ✓ | ✓ | ✓ | **H-02 corrected** — live is the SAFE 1-arg `auth.uid()` version (anon raises `not_authenticated`); the 2-arg exploit (mig `2026_06_16`) is committed-but-unapplied → moved to P3 |
| `eq_cards_submit_access_request(uuid,text)` | ✓ | ✗ | ✓ | **H-09 corrected** — `anon`=false (correct); `auth.uid()`-bound → hygiene + rate-limit only |

**Still to verify (env/dashboard, not in code):**
1. **H-10** — `licence-photos` bucket `public=false`, tenant-prefix RLS, no anon, upload paths carry the prefix.
2. **H-04** — phone OTP enabled in prod + SMS provider rate limits.
3. **H-07** — `CANONICAL_API_KEY_CARDS` not extractable from the eq-cards web bundle.
4. **H-15 / H-18** — `netlify env:get EQ_SESSION_SALT / EQ_QUOTES_HANDOFF_KEY / ENFORCE_IFRAME_ORIGIN` per site (MCP env reads silently no-op — use the CLI).

---

## 5. Sequencing & the keystone

- **Ship P0 as a tight batch** — H-01/H-03/H-04/H-05 are ~1-line each (REVOKE, expiry
  check, `shouldCreateUser:false`, tenant-scope). Highest value-per-effort in the
  program; they close trivially-reachable whole-tenant-lockout, leaked-link tenant
  creation, SMS toll fraud, and a cross-tenant IDOR.
- **H-06 is the keystone.** Land the function-EXECUTE drift CHECK early in P1 — it
  catches V1/V2 and the whole SECDEF-anon class (incl. the latent H-02 if ever applied)
  automatically. Without it, the class is whack-a-mole. (Sequence it *after* the V1/V2
  revoke lands, so the gate goes green not red on first run — add the deliberately-
  `authenticated` family to its allow-list.)
- **H-00 first within the V1/V2 track** — confirm the JWT variant before building
  `canon-read.js`, so we never put a cross-entity service-role key on the SKS deploy.
- **P1 data-harvest (H-07/H-08/H-10)** before broadening the user base further — these are
  the "one leak = all-tenant PII" items.
- **P2/P3** are the durable posture: erasure/retention (the biggest compliance item),
  key isolation + rotation, PII-in-logs, origin enforcement, then the cleanups.

**One-sprint cut if scope must shrink:** all of P0 + H-06 + H-08 + H-10 + H-11. That
closes every active exploit, installs the systemic guard, and stops the worst PII
over-exposure — the rest becomes a fast-follow.
