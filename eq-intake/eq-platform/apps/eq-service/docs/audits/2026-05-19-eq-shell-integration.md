# EQ Shell integration proposal for EQ Service

**Status:** Research-only proposal. No code changed. Awaiting Royce decision.
**Created:** 2026-05-19
**Companion design doc:** [EQ-SHELL-DESIGN.md](https://github.com/Milmlow/eq-field-app/blob/demo/EQ-SHELL-DESIGN.md) (Q1-Q10 locked 2026-05-18)
**Companion repo:** `C:\Projects\eq-shell\` — Phase 1.A scaffold (Vite + React + TS, currently a 5-route Tender Pipeline spike)

---

## TL;DR

- Three integration paths exist for plugging EQ Solves Service into the EQ Shell that's coming online at `*.eq.solutions`: **(A) Iframe under shell chrome**, **(B) Auth-share + redirect to the existing Next.js app**, **(C) Full port of Service into the shell as a lazy React module**.
- **Recommendation: Option B (Auth-share + redirect)** for the immediate next step, with Option C as the long-term destination at Phase 3+.
- Option A (iframe, the path EQ Field is taking) is **not viable for Service without active intervention** — Service's [`public/_headers`](../../public/_headers) sets `X-Frame-Options: DENY` and `frame-ancestors 'none'` in CSP. Both would need to relax to allow framing from `*.eq.solutions`. The current Service auth model also assumes a Supabase session cookie, which is set on `*.netlify.app` and won't reach `*.eq.solutions` regardless of frame policy.
- Option C is the right long-term shape but is a 4-6 week project at minimum — Service is ~140 server-action files, ~100 migrations, a deep Next.js 16 dependency, and a feature surface that has live customers (SKS + Jemena onboarding).
- Option B fits the architecture EQ Shell already locked at Q4 (HMAC-signed cookie + 60s minted token) without rewriting the Service app. Service stays on Next.js, stays on its existing Supabase project (`urjhmkhbgaxrofurpbgc`), and gains a single new auth surface: a `/auth/shell-bridge` endpoint that validates a shell-minted token and turns it into a Supabase session.
- Major risks: (1) **two Supabase projects must reconcile user identity** (shell uses `eq-shell-control` / `hxwitoveffxhcgjvubbd`, Service uses `urjhmkhbgaxrofurpbgc`); (2) **MFA tension** — shell currently uses an email + PIN, Service enforces full Supabase MFA at AAL2; (3) **session lifetime mismatch** — shell cookie is 7d, Service Supabase session is whatever Supabase Auth defaults to. None of these block Option B, but each needs an explicit decision.
- Estimated effort for Option B: **~3-4 sessions** across Service, Shell, and the canonical Supabase. Touches ~5 Service files and adds 1 new route. No data migration. Reversible.

---

## 1. Background and current state

### What EQ Shell is

EQ Shell (`C:\Projects\eq-shell\`, GitHub `eq-solutions/eq-shell`) is a new multi-module React shell whose Q1-Q10 design decisions were locked on 2026-05-18. It's a Vite + React + TypeScript + React Router app hosted on Netlify at `*.eq.solutions`. The intent is to host Cards / Intake / Quotes / Service / Field as lazy-loaded modules under one authenticated shell.

**Critical state note:** the prompt for this proposal references files (`netlify/functions/`, `src/session.ts`, `src/brand.tsx`, `src/pages/FieldIframe.tsx`) that do **not yet exist** in the shell repo. As of 2026-05-19 the shell is at Phase 1.A scaffold only — README, package.json, `src/main.tsx`, `src/App.tsx`, and a `src/modules/tender-pipeline/` 5-page spike. The three auth functions (`shell-login`, `verify-shell-session`, `mint-iframe-token`), the `_shared` helpers, the SessionContext, the BrandProvider, and the FieldIframe page are all **Phase 1.B work that hasn't landed yet**. This proposal therefore plans against locked design-intent, not running code.

The design doc commits the shell to: Vite + React + TS (Q1); iframe MVP for Field + new screens as React shell-routes + gradual surface migration (Q2); canonical Supabase `eq-shell-control` owning `tenants` / `users` / `module_entitlements` / `branding` while each tenant keeps their own Supabase for app data (Q3); HttpOnly cookie `eq_shell_session` on `.eq.solutions` with 7d TTL + HMAC-signed, with cross-domain modules (Field today) getting a 60s minted token via URL hash (Q4); lazy-load + runtime gate per module (Q5); brand object in React Context for modules and URL hash for the Field iframe (Q6); marketing stays at `eq.solutions` root with shell on `*.eq.solutions` subdomains (Q9); Tender Pipeline split out as its own module (Q10).

Phase plan: 1.A scaffold (in progress), 1.B wire-up (next), 1.C field-side `?sh=` handler, 1.D end-to-end smoke, 2 Tender Pipeline React migration, 3+ surface-by-surface Field migration, 4 vanilla Field decommission. **Service is not in the named phase plan.** Slotting it in is the question this doc answers.

### What EQ Solves Service is

EQ Service is the Next.js 16 app at this repo. Live deploy at `eq-solves-service.netlify.app`. Customers: SKS Technologies (the primary live tenant) and Jemena NSW (onboarded April 2026). Stack: Next.js 16 + React 19 + Supabase + Tailwind CSS 4. Supabase project is `urjhmkhbgaxrofurpbgc` — separate from the shell's canonical `eq-shell-control` project. Service owns its own `tenants`, `tenant_members`, `profiles`, and the deep schema (~100 migrations) for maintenance checks, ACB/NSX/RCD testing, defects, reports, contract scope, etc.

Auth model is Supabase Auth password + email, AAL2 MFA enforced via [`proxy.ts`](../../proxy.ts) and [`lib/auth/mfa-routing.ts`](../../lib/auth/mfa-routing.ts). Sessions are Supabase SSR cookies via `@supabase/ssr`, named `sb-<project-ref>-auth-token`, set on the eq-solves-service.netlify.app origin. All mutations follow the `requireUser()` → role check → Zod validate → Supabase mutate → audit log → revalidate pattern from [AGENTS.md](../../AGENTS.md). Security headers in [`public/_headers`](../../public/_headers) lock framing tight: `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`. Custom roles `super_admin` / `admin` / `supervisor` / `technician` / `read_only` resolve per tenant from `tenant_members.role` (see [`lib/utils/roles.ts`](../../lib/utils/roles.ts) and [`lib/actions/auth.ts`](../../lib/actions/auth.ts)). Tenant assignment runs through [`app/(app)/admin/users/actions.ts`](../../app/(app)/admin/users/actions.ts) `inviteUserAction`. The app is preparing for go-live — the integration shouldn't destabilise that.

---

## 2. The five core questions

The prompt frames the integration around five questions. Take them in turn.

### Q1. Auth contract fit — Shell HMAC cookie vs Supabase session cookie

The shell auth contract (Q4 in the design doc) is intentionally minimal: one cookie, set HttpOnly + Secure + SameSite=Lax + domain=`.eq.solutions`, ~7-day TTL, contents are an HMAC-signed payload validated by `verify-shell-session`. Cross-domain iframes (Field today) get a 60-second short-lived HMAC token passed via URL hash, validated by the iframed app's existing PIN-verify endpoint extended with a new `action="verify-shell-token"` case.

Service uses `@supabase/ssr` (see [`lib/supabase/middleware.ts`](../../lib/supabase/middleware.ts) and [`lib/supabase/server.ts`](../../lib/supabase/server.ts)). The cookie is owned by the Supabase client, refreshed every request through `updateSession()` in `proxy.ts`. Session contents are a Supabase JWT pair (access + refresh), bound to the Supabase project `urjhmkhbgaxrofurpbgc`. The middleware also reads MFA AAL state and force-redirects AAL1-with-enrolled-factor users to `/auth/mfa`.

These two systems don't share a secret, a domain, a cookie name, or a session contract. They can be bridged in two ways:

1. **Mint a Supabase session from a shell-validated token.** The shell, knowing its cookie is valid, generates a short-lived signed assertion (the same 60s HMAC token shape it'll use for Field) embedding `{user_email, tenant_slug, shell_user_id}`. The shell drives the browser to `https://eq-solves-service.netlify.app/auth/shell-bridge?sh=<token>`. A new Service route validates the HMAC (shared secret from Netlify env), looks up the matching `profiles` row by email, calls `supabase.auth.admin.generateLink({ type: 'magiclink' })` for that user, then follows the link server-side to land the user in a real Supabase session. From there `proxy.ts` works as today.

2. **Carry the Supabase session over a custom claim.** Get the shell to actually drive Service's `signInWithPassword` (or refresh-token flow) and propagate the resulting Supabase session cookie. This is uglier — the shell becomes a Supabase Auth client for two projects (its own + Service's), and the cookie isolation between origins forces yet another redirect to land on the eq-solves-service origin.

Path 1 is the recommended Option B mechanic. The HMAC handshake is exactly the same pattern the shell will use for Field, so there's one auth-share primitive across both modules. The Supabase-side hand-off via `generateLink` is a documented Supabase admin API.

**The big footgun:** for path 1 to work, the user's `auth.users.id` in the Service Supabase project must already exist, and there must be a `tenant_members` row for them with a role. If those don't exist, Service shows the "No tenant assigned" screen from `app/(app)/layout.tsx`. The shell can't lazily create Service users by itself unless it gets a Service-side admin API endpoint to do so. This is solvable (a `provisionShellUserAction` mirroring `inviteUserAction`) but it's a Service-side change with auth-flow implications and warrants Royce-side approval per the AGENTS.md "auth changes require explicit approval" rule.

### Q2. Tenant model fit — eq-shell-control vs urjhmkhbgaxrofurpbgc

The shell's canonical Supabase (`eq-shell-control`, project id `hxwitoveffxhcgjvubbd`) owns:

```sql
tenants               (id uuid pk, slug text unique, name, brand_color, supabase_project_id, created_at)
users                 (id uuid pk, email, pin_hash, tenant_id fk, role, created_at)
module_entitlements   (tenant_id fk, module text, enabled boolean, primary key (tenant_id, module))
```

Module enum: `field` / `cards` / `intake` / `quotes` / `service` / `tender_pipeline`. So `service` is already named.

Service's Supabase (`urjhmkhbgaxrofurpbgc`) has its own `tenants` table (with `tier`, `compliance_tier`, `setup_completed_at`, etc.), a `tenant_members` join table, a `profiles` table mirroring `auth.users`, and the entire app schema. The role enum (`super_admin` / `admin` / `supervisor` / `technician` / `read_only`) is per-tenant and richer than the shell's `role` column (which the design doc doesn't enumerate beyond "role text").

The reconciliation needs a **mapping convention**:

| Shell concept | Service concept | Mapping rule |
|---|---|---|
| `tenants.slug` (e.g. `sks`) | `tenants.slug` (the new column added in migration 0011 etc.) | Slug match. Canonical wins on case (lowercase). Shell must mirror the Service slug when provisioning a Service-enabled tenant. |
| `tenants.id` (canonical) | `tenants.id` (Service) | Different UUIDs by design — each Supabase project has its own. Shell's `tenants.supabase_project_id` is the bridge. |
| `users.email` (canonical) | `profiles.email` / `auth.users.email` | Email-only mapping. Recommend lowercased-on-insert in both places; Service already does this in `InviteSchema.email.transform`. |
| `users.role` (canonical) | `tenant_members.role` (Service) | Not directly. Shell's role concept is a coarser "is this user allowed into shell modules at all". Service's per-tenant role is authoritative for Service's RBAC. Treat shell-side role as a billing/access marker, not an authorisation source. |
| `module_entitlements (tenant_id, 'service', enabled)` | (no analogue today) | The entitlement gate sits on the shell side. Service renders its own UI assuming the user is already past the gate. |

**The cleanest rule:** the canonical Supabase is the source of truth for "does this user, on this tenant, have access to the Service module at all". The Service Supabase remains the source of truth for "what tenant_member role do they have, what data can they see". Mapping is by `(tenant.slug, user.email)` — both stable, both human-readable, both already enforced unique where it matters.

This is the same shape the design doc Q3 chose ("each tenant keeps their own Supabase for app data; shell reads canonical; modules read their tenant's project"). The proposal here is faithful to that, just naming the keys.

### Q3. The three integration options

#### Option A — Iframe under shell chrome

Same approach EQ Field is taking in Phase 1. Shell route `/<tenant>/service` mints a 60s HMAC token, embeds `<iframe src="https://eq-solves-service.netlify.app/auth/shell-bridge#sh=<token>">`. Service's bridge endpoint validates the token, signs the user in (Supabase admin generate-link flow), and renders the rest of the app inside the iframe.

**Why this is harder than it looks for Service:**

- **CSP blocks it.** [`public/_headers`](../../public/_headers) sets `frame-ancestors 'none'` (Report-Only, about to flip to enforced) plus `X-Frame-Options: DENY`. Both must relax — a deliberate weakening of clickjacking protection, needing the AGENTS.md 24h Report-Only soak before enforcement.
- **Cookie partitioning.** Modern browsers (Chrome 113+, Safari, Firefox) increasingly partition third-party cookies in iframes. Supabase's session cookie is third-party when set under `<iframe src=eq-solves-service.netlify.app>` parented by `sks.eq.solutions`. CHIPS would let it work but requires `Partitioned`; Supabase SSR doesn't set that flag today.
- **MFA inside an iframe is rough.** Service redirects AAL1+enrolled-factor users to `/auth/mfa`. Inside an iframe authenticator-app context, paste behaviour, and autofill all degrade. CLAUDE.md flags this surface as a known regression hotspot.
- **Navigation contract.** Service has deep links (`/maintenance/[id]`, `/testing/acb/[testId]`, etc.). The shell URL stays at `/<tenant>/service` while only the iframe URL changes — bookmarks break, back-button gets confusing, email-deeplinks want the shell origin.
- **Visual chrome.** Service already renders its own sidebar via `(app)/layout.tsx`. Inside the shell, you'd have shell chrome + Service chrome (two sidebars) — either Service's sidebar disappears (behaviour fork) or the shell renders no chrome (defeats the point).

Option A is **not the same risk profile as Field**. Field is vanilla JS with a thinner auth surface and simpler UI — iframe fits it. Service has too much surface area for the iframe to be a comfortable host.

#### Option B — Auth-share + redirect (RECOMMENDED for next step)

Shell route `/<tenant>/service` does **not** render an iframe. Instead, when the user clicks the Service tile from the shell nav, the shell:

1. Mints a 60-second HMAC token like the Field flow, but with target audience `service` (so it can't be replayed against Field, and vice versa).
2. Issues a 302 to `https://eq-solves-service.netlify.app/auth/shell-bridge?sh=<token>&next=/dashboard`.

Service's new `/auth/shell-bridge` route handler:

1. Validates the HMAC against the shared secret (`EQ_SHELL_BRIDGE_SECRET` env var on Service).
2. Verifies the token's `aud === 'service'`, `exp` is in the future, `iss === 'eq-shell'`.
3. Reads `email` and `tenant_slug` from the token payload.
4. Looks up the matching `auth.users` row by email via the Supabase admin client. If the user doesn't exist, redirects to a "Contact your administrator — your account isn't provisioned in EQ Service yet" page. (Auto-provisioning is a separate Royce decision — Section 3 below.)
5. Verifies the user has an active `tenant_members` row whose tenant's slug matches the token's `tenant_slug`. If not, same fall-through page.
6. Generates a magic link via `supabase.auth.admin.generateLink({ type: 'magiclink', email })`, then drives the user through it server-side so the Supabase cookie gets set on the eq-solves-service.netlify.app origin.
7. Redirects to `next` (the requested deep link, defaulted to `/dashboard`).

Once the Supabase cookie is set, the rest of Service works exactly as today. `proxy.ts` validates the session, runs MFA gates, enforces tenant membership, renders the app. The user is on `eq-solves-service.netlify.app` in their browser bar — not on `sks.eq.solutions` — which is the trade-off vs Option A.

**Why the URL bar change is OK:**
- The shell stays the home base. Users come from the shell, go to a module, get done, come back. Familiar pattern (think Google Workspace — you're on `mail.google.com`, then `drive.google.com`, then `docs.google.com`).
- It matches the design doc's own admission for Field (Q4): "When `eq-solves-field` is eventually moved under `field.eq.solutions` (subdomain alias), the URL-hash dance goes away and Field becomes cookie-native." The exact same future applies to Service — once Service lives at `service.eq.solutions`, the shell cookie reaches it natively and the bridge can disappear.
- A small "Return to shell" button in the Service top-right (already a small UI add) softens the disorientation.
- The shell's nav stays consistent because the user is one tab-back away from `sks.eq.solutions/`.

**Why it beats Option A:**
- No CSP / frame-ancestors change. Security-headers stay tight.
- No iframe MFA pain. Supabase MFA runs in its native top-level browsing context.
- No double-sidebar problem.
- Deep links work natively. Browser back-button behaves.
- The bridge primitive is small enough that a security review can fit on one page.

**Why it's only "next step", not "destination":**
- Long-term, Service should be a first-class lazy React module inside the shell (Option C). That's the design-doc trajectory for every module. Option B is a 12-24 month bridge until Service is ready to port — same envelope the design doc gives Field.

#### Option C — Port Service into the shell as a lazy React module

The honest endpoint of the design doc trajectory. Service stops being a Next.js app entirely; its UI becomes `src/modules/service/` inside `eq-shell`, lazy-loaded with `React.lazy()`. The Supabase project `urjhmkhbgaxrofurpbgc` stays as-is (Service's app data), but UI rendering and auth move into the shell.

**Scope (very rough):** ~25 top-level routes become React Router routes; ~140 server actions either rewrite as Supabase client-side calls (RLS does the gate) or move into Netlify Functions for must-stay-server-side bits (DOCX/PDF generation, cron, email send, service-role audit writes); all MFA + invite + reset flows re-implement on the shell auth contract; vitest suites port over.

**Effort:** 4-6 weeks full-time minimum. Realistic delivery: a quarter. Not a Phase 1.B job.

**Why it's still the right destination:** single design system, single auth surface (one MFA flow to harden), code splitting at the module level (users who never open Service never download Service's JS), and the data layer already aligns with design doc Q3 so the port doesn't have to move data. **Why Option B is the on-ramp:** Option B is reversible. If Option C trade-offs change midway, Service stays a working Next.js app. Option A would have left half-applied CSP weakening to back out.

### Q4. Recommendation

**Option B for the immediate next step.** Pros/cons matrix below.

| Criterion | A: Iframe | B: Auth-share + redirect (recommended) | C: Port to shell module |
|---|---|---|---|
| Effort (sessions) | 2-3 (but the CSP relaxation needs a deploy-and-soak cycle) | 3-4 | 25-40 |
| Service code touched | ~5 files (headers, CSP, plus bridge) | ~5 files (bridge + middleware exemption) | every file |
| Reversible? | Yes (revert CSP) | Yes (drop bridge route) | Effectively no — Service-as-Next.js stops existing |
| Affects security headers? | Yes — relaxes frame-ancestors + X-Frame-Options | No | Service-the-deploy goes away; security headers move to shell |
| Affects MFA flow? | Indirectly — MFA inside iframe is a known regression hotspot | No — MFA stays the way it works today | Rewrite required |
| Deep links work? | Awkward (iframe URL changes, shell URL doesn't) | Yes — same deep-link behaviour as today | Yes — under shell routes |
| Cookie partitioning risk? | Yes — modern browsers may partition the Supabase cookie | No | No |
| Visual: single chrome? | No — double sidebar or behaviour fork | No — but the URL bar shifts | Yes |
| Shell-cookie reaches Service? | No — Service is on `.netlify.app`, shell cookie is on `.eq.solutions` | No — and that's OK; bridge primitive handles the gap | Yes |
| Long-term aligned with design doc Q2 trajectory? | Yes (iframe MVP) | Sort of — it's the "redirect MVP" alternative for apps that can't iframe | Yes (final state) |
| Aligned with design doc Q4 cookie story for Field? | Yes (same shape) | Yes (the cross-domain redirect is the same shape, minus the iframe wrap) | N/A |
| Risk of regression to Service go-live? | High — CSP + MFA both load-bearing | Low — new isolated route, no change to existing surface | High — full rewrite |

Recommendation summary: **B is the lowest-risk path that gets Service inside the shell experience now.** A is technically possible but fights Service's existing security posture. C is the destination but isn't the next step.

A useful framing: **B is to Service what the URL-hash dance is to Field.** Both are bridges that exist for as long as the module is on a different origin from the shell. Both disappear when the module gets a `*.eq.solutions` subdomain (Service moves to `service.eq.solutions` or, eventually, Option C subsumes it).

### Q5. File-by-file work estimate for Option B

LOC is approximate, risk is qualitative.

**EQ Shell side (the new repo at `C:\Projects\eq-shell\`):**

| File | Action | LOC | Risk |
|---|---|---|---|
| `C:\Projects\eq-shell\netlify\functions\mint-iframe-token.ts` (Phase 1.B work) | Extend mint to support `aud="service"` in addition to `aud="field"`. Same HMAC primitive, different audience claim. | +30 | Low — same code path as Field. |
| `C:\Projects\eq-shell\src\modules\service\ServiceLauncher.tsx` (new) | Module entry that, on mount, requests a `service` token and 302s to `https://eq-solves-service.netlify.app/auth/shell-bridge?sh=<token>&next=/dashboard`. Renders a spinner during the redirect. | ~60 | Low. |
| `C:\Projects\eq-shell\src\App.tsx` (Phase 1.B router) | Add route `/<tenant>/service/*` → `ServiceLauncher`. | +5 | Low. |
| `C:\Projects\eq-shell\netlify\functions\_shared\token.ts` (Phase 1.B helper) | Make sure the token shape supports multiple audiences cleanly — Field gets `aud="field"`, Service gets `aud="service"`. | +10 | Low. |

Phase 1.B is doing this work for Field anyway; Service is one extra audience in the same code.

**EQ Solves Service side (this repo):**

| File | Action | LOC | Risk |
|---|---|---|---|
| `app/(auth)/auth/shell-bridge/route.ts` (new) | New GET route handler. Validates HMAC, looks up `auth.users` by email via admin client, verifies `tenant_members` membership matches the token's `tenant_slug`, generates magic link via admin API, redirects through it to set the Supabase cookie, then 302s to `next`. | ~140 | Medium — new auth surface, needs careful review. Falls under AGENTS.md "auth changes require chat heads-up". |
| [`lib/auth/mfa-routing.ts`](../../lib/auth/mfa-routing.ts) | Add `/auth/shell-bridge` to `PUBLIC_PATHS` so unauthenticated arrivals don't bounce. | +1 | Low — matches the existing `/auth/accept-invite` exemption. |
| [`lib/env.ts`](../../lib/env.ts) | Add `EQ_SHELL_BRIDGE_SECRET` to server schema. | +3 | Low. |
| `lib/auth/shell-bridge.ts` (new) | Pure HMAC validation helper + Zod schema for the token payload. Easier to unit-test in isolation. | ~80 | Low — pure functions, no Supabase calls. |
| `tests/lib/auth/shell-bridge.test.ts` (new) | Vitest spec for the HMAC validator: rejects expired, wrong audience, wrong issuer, bad signature, missing claims. | ~120 | Low. |
| [`public/_headers`](../../public/_headers) | **No change.** CSP and X-Frame-Options stay locked. Bridge doesn't need to iframe. | 0 | N/A. |
| [`proxy.ts`](../../proxy.ts) | **No change.** `/auth/shell-bridge` becomes public via the mfa-routing list; proxy.ts already exempts public paths. | 0 | N/A. |
| `app/(app)/layout.tsx` | Optional: add a small "Return to shell" link in the header for users who arrived via the bridge. Detect via a session-storage flag set by the bridge route. | ~15 | Low — cosmetic. |
| `docs/runbooks/shell-bridge.md` (new) | Operator runbook: env vars to set, how to rotate the HMAC secret, how to trace a failed bridge in Sentry. | ~80 | Low. |

**Canonical Supabase (`eq-shell-control`) side:**

| Change | LOC (SQL) | Risk |
|---|---|---|
| `module_entitlements` row for each tenant that has Service: `(tenant_id, 'service', true)`. | 3 per tenant | Low — data, not schema. |
| `tenants.supabase_project_id = 'urjhmkhbgaxrofurpbgc'` for tenants whose Service data lives there. | 1 per tenant | Low. |
| Mapping convention: shell `tenants.slug` must exactly match Service `tenants.slug`. | Operational | Medium — needs runbook discipline so a tenant isn't named differently in the two projects. |

**Netlify env vars:**

- `EQ_SHELL_BRIDGE_SECRET` on both the shell deploy and Service deploy. 256-bit random, rotated on schedule. Same secret on both sides so HMAC verifies.

**Sentry / observability:**

- Add a `mfa_redirect`-style server event in the bridge route: `shell_bridge_attempted`, `shell_bridge_failed` (with reason), `shell_bridge_succeeded`. PostHog server-side track event keeps recurrence visible if the bridge ever degrades.

**Total Service-side scope:** ~5 files touched/added in this repo, ~360 LOC, no schema changes, no deploy of existing functionality. **Total cross-repo scope:** ~10 files, ~400 LOC.

### Q6. Risks + open questions

The five Royce-side decisions this proposal needs to surface.

#### Risk 1 — User identity mapping across two Supabase projects

The hard question: when Royce provisions a new tenant in the shell (`eq-shell-control`), and Service is one of their enabled modules, **how does the user account get into Service's Supabase**?

Three options:

1. **Manual sync.** Shell admin creates the user in the canonical Supabase. Royce (or a SKS admin) separately uses Service's existing `/admin/users` Invite User flow to create the user in Service. Two manual steps per user but zero extra code.
2. **Shell calls a Service-side admin API.** Shell exposes a "provision user" button that POSTs to `https://eq-solves-service.netlify.app/api/admin/provision-from-shell` with an HMAC-signed payload. The Service endpoint mirrors `inviteUserAction`. Adds Service-side code but makes provisioning a one-click flow.
3. **Just-in-time provisioning at the bridge.** The bridge route, on first arrival with a valid token, auto-creates the `auth.users` row and `tenant_members` row if missing. Single button click for the end user; zero admin steps. Highest blast-radius: a token forgery would give automatic account creation.

Recommendation: **(2) for now.** Manual is friction; JIT is a security expansion that wants a separate audit. Explicit admin action with an HMAC envelope is the middle path.

#### Risk 2 — MFA tension (shell PIN vs Service AAL2)

The design doc Q4 spells out the shell auth: "Login posts to `/.netlify/functions/shell-login` → validates credentials → sets `eq_shell_session` cookie". Credentials in the design doc are email + PIN (Field's existing 8-digit PIN model, validated via the existing `verify-pin` Netlify function). No MFA.

Service requires AAL2 — every non-demo user with an enrolled TOTP factor must complete the factor challenge per request. The bridge skips this — once the Supabase cookie is set the proxy will still enforce AAL2, which means: **the user lands at `/auth/mfa` and has to enter their TOTP code despite already being signed into the shell**.

Three positions Royce could take:

1. **Accept the second factor.** Service is the high-value surface — defects, compliance reports, customer data. AAL2 is worth the bump. The "Sign in via Shell" experience is "PIN to enter shell, TOTP to enter Service". One-time per session per device.
2. **Trust the shell.** The bridge route, on validating a fresh token, sets a Supabase session at AAL2 directly via admin claims. Shell becomes a trusted MFA source. This is a meaningful expansion of the shell's security posture — it'd need the shell login itself to be AAL2-grade (which a PIN isn't).
3. **Two-tier shell auth.** Shell-login is PIN. Shell-to-Service handshake additionally requires the user to verify a TOTP at the shell level before the bridge mint succeeds. Maintains AAL2 at the Service edge without requiring a re-prompt inside Service.

Recommendation: **(1).** Cheapest, safest, doesn't require touching the design doc's locked Q4 decision. The double-prompt is a UX cost; the alternative is a security regression on the live SKS deploy.

#### Risk 3 — Session lifetime mismatch (7d shell vs Supabase default)

Shell cookie: 7 days. Supabase session: refresh token 30 days by default, access token 1 hour, refreshed transparently.

This means a user can be signed into the shell for 7 days but have their Supabase session expire silently before that. They click "Service" from the shell nav, the bridge mints a token, the bridge handles the magic-link sign-in, fresh Supabase session — no problem. The mismatch only matters if a user opens Service directly (not via the shell) after their Supabase session expired but the shell session is still alive. Today that path doesn't exist (no one's bookmarking eq-solves-service.netlify.app once the shell is the front door), so the mismatch is effectively zero-impact at MVP.

No action required. Document the asymmetry in the runbook so future maintainers don't go hunting for a bug that isn't there.

#### Risk 4 — Slug drift between canonical and Service

If the canonical Supabase says a tenant is `sks` and Service says it's `sks-technologies`, the bridge breaks for that tenant. There's no enforcement today.

Mitigation:
- Bridge route validates the token's `tenant_slug` matches a Service `tenants.slug` exactly. If not, redirects to an error page that says "Tenant slug mismatch — contact support."
- Runbook for provisioning a tenant: the slug is set on the canonical side first, then mirrored exactly when running the Service-side seed.
- Optional: a nightly Netlify Scheduled Function that queries both projects (with read-only Supabase API keys) and PostHog-events any slug mismatch. Cheap to add later.

#### Risk 5 — Auth-flow review requirement

Per [AGENTS.md](../../AGENTS.md): "Any change to the auth flow, MFA, session handling, or password reset requires a chat heads-up first." The bridge route IS an auth-flow change. This proposal doc + a brief in chat is the right shape; explicit Royce signoff before the first code commit on Service is mandatory.

---

## 3. Shippable units (if Option B is approved)

Three commits, each independently reversible, each behind a feature flag until smoke-tested.

**Unit 1 — Bridge primitive (Service-side).** New route `app/(auth)/auth/shell-bridge/route.ts`, helper `lib/auth/shell-bridge.ts`, vitest spec, mfa-routing exemption, env var, runbook. Behind an env-var gate: when `EQ_SHELL_BRIDGE_SECRET` is unset the route returns 404. PR-sized.

**Unit 2 — Shell module entry.** `src/modules/service/ServiceLauncher.tsx`, App.tsx route addition, mint-iframe-token audience extension. Lives in `eq-shell` repo. PR against `main` of that repo.

**Unit 3 — Canonical Supabase data.** Insert `module_entitlements` for SKS and Jemena (the two known live tenants), set `supabase_project_id` on those tenant rows. Single SQL migration in the canonical project's migrations folder.

**End-to-end smoke after all three:** Royce opens `sks.eq.solutions`, signs in with the shell login, clicks "Service" from the tenant home, browser redirects to `eq-solves-service.netlify.app/auth/shell-bridge`, sees the magic-link hop transparently, lands on `/dashboard` as the SKS super_admin, completes MFA once, works in Service as normal. Repeat for Jemena. Repeat with a `read_only` Service user to confirm the role gate still works. Repeat with a user who doesn't have a Service entitlement to confirm the fall-through page renders.

Estimated calendar time: 3-4 working sessions across all three units. None of them are urgent — the shell itself isn't past Phase 1.B yet.

---

## 4. What this proposal explicitly does NOT decide

- **Whether to actually ship Option C in 2026.** Decided later, after Phase 2 (Tender Pipeline) validates the React-module shape and after Phase 3 of the design doc plays out for Field surfaces.
- **The shell's authentication contract.** That's locked at Q4 in the design doc. This proposal is downstream of that.
- **The canonical Supabase schema beyond what's already in the design doc.** No new tables proposed; just data rows.
- **Whether to give Service a `service.eq.solutions` subdomain.** That's a Q4-trajectory decision — same path as Field's eventual `field.eq.solutions`. Once Service is on `*.eq.solutions`, the bridge can retire and the shell cookie reaches Service directly. **Recommended as a Phase 2 follow-up** once Option B is bedded in: pointing `service.eq.solutions` at the existing Netlify deploy is a DNS change plus a Netlify domain alias, not an app rewrite. The shell cookie's `domain=.eq.solutions` then auto-reaches Service and the bridge becomes a no-op. This step is mentioned for completeness but is not the immediate next step.
- **MFA harmonisation across shell and Service.** Risk 2 above flags this; the recommendation is to accept the double-prompt for now. Real harmonisation requires upgrading shell-login to an AAL2-grade primitive, which is a separate design conversation.

---

## 5. Open questions for Royce

These are the click-options-worth pieces of this doc. None of them need an answer today; surfacing them so the doc is a complete picture.

1. **Approve Option B as the immediate next step?** A: Yes, B is the bridge; C is the destination. B: No, port directly to Option C (4-6 week project). C: No, push for Option A (iframe — accept the CSP relaxation). D: Free text.
2. **User identity mapping — which provisioning path?** A: Shell calls a Service-side admin API endpoint (Risk 1 option 2). B: Manual sync — admin creates the user in both places. C: Just-in-time at the bridge — auto-create on first arrival. D: Free text.
3. **MFA stance for Service-via-Shell?** A: Accept the double prompt (PIN at shell, TOTP at Service). B: Trust the shell — bridge sets AAL2 directly. C: Two-tier — require TOTP at the shell layer before bridging. D: Free text.
4. **When should `service.eq.solutions` come online?** A: Phase 2 follow-up after Option B is bedded in. B: At Option B launch — point DNS while we're at it. C: Not until Option C is on the roadmap. D: Free text.
5. **Sentry alert routing for bridge failures?** A: Same dev@eq.solutions destination as existing Sentry alerts. B: New alert rule with higher severity for repeated failures (potential token forgery). C: PostHog-only for now, Sentry alert only after first failure observed. D: Free text.

---

## Appendix A — File references

**EQ Shell repo (absolute paths):** `C:\Projects\eq-shell\README.md`, `C:\Projects\eq-shell\package.json`, `C:\Projects\eq-shell\src\App.tsx`, `C:\Projects\eq-shell\src\main.tsx`, `C:\Projects\eq-shell\src\modules\tender-pipeline\index.tsx`. Not yet present, expected Phase 1.B: `C:\Projects\eq-shell\netlify\functions\{shell-login,verify-shell-session,mint-iframe-token}.ts`, `C:\Projects\eq-shell\netlify\functions\_shared\{token,supabase}.ts`, `C:\Projects\eq-shell\src\{session.ts,brand.tsx,pages\FieldIframe.tsx}`.

**EQ Shell design doc:** [EQ-SHELL-DESIGN.md](https://github.com/Milmlow/eq-field-app/blob/demo/EQ-SHELL-DESIGN.md) (fetched 2026-05-19 via `gh api repos/Milmlow/eq-field-app/contents/EQ-SHELL-DESIGN.md?ref=demo`).

**EQ Solves Service repo (relative paths from this doc):**
- [`proxy.ts`](../../proxy.ts) — middleware auth + MFA gates
- [`lib/supabase/middleware.ts`](../../lib/supabase/middleware.ts), [`server.ts`](../../lib/supabase/server.ts), [`client.ts`](../../lib/supabase/client.ts), [`admin.ts`](../../lib/supabase/admin.ts) — Supabase clients
- [`lib/auth/mfa-routing.ts`](../../lib/auth/mfa-routing.ts) — PUBLIC_PATHS / AAL_EXEMPT_PATHS / shouldChallengeMfa
- [`lib/actions/auth.ts`](../../lib/actions/auth.ts) — `requireUser()` helper
- [`lib/utils/roles.ts`](../../lib/utils/roles.ts) — role hierarchy
- [`lib/env.ts`](../../lib/env.ts) — env-var Zod schemas
- [`app/(app)/layout.tsx`](../../app/(app)/layout.tsx) — tenant_member gate + "No tenant assigned" screen
- [`app/(auth)/auth/signin/actions.ts`](../../app/(auth)/auth/signin/actions.ts), [`callback/route.ts`](../../app/(auth)/auth/callback/route.ts) — sign-in entry + callback
- [`app/(app)/admin/users/actions.ts`](../../app/(app)/admin/users/actions.ts) — invite + tenant-member upsert pattern
- [`public/_headers`](../../public/_headers) — CSP + X-Frame-Options (the iframe-blocker)
- [`next.config.ts`](../../next.config.ts), [`netlify.toml`](../../netlify.toml) — build config
- [`AGENTS.md`](../../AGENTS.md), [`CLAUDE.md`](../../CLAUDE.md) — security invariants and patterns

---

**End of proposal.** No code modified; doc-only commit incoming.
