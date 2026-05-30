# EQ Shell

Multi-module React shell for `*.eq.solutions` tenants. Hosts Cards / Intake / Quotes / Service / Field as lazy-loaded modules under one authenticated shell.

**Mission:** Built for Royce first, then SKS NSW, then beyond. Architecture done right, done once. Product quality drives adoption — not sales hustle. See [docs/ARCHITECTURE-V2.md](docs/ARCHITECTURE-V2.md) for the canonical architecture target.

**Status:** **Phase 2 closed (2026-05-25).** Per-tenant data plane is live: every operational entity (customers, contacts, sites, staff, licences, schedules, prestarts, toolbox talks, tenders, service jobs, quotes, intake batches) lives exclusively on a per-tenant Supabase project (`eq-canonical-internal`, `sks-canonical`). Shared `eq-canonical` holds only the control plane (`shell_control` — tenants, users, entitlements, encrypted `tenant_routing`) plus auth/storage. Security audit Blocks 1 + 2 shipped same day (CSP + headers, fail-loud secrets, fail-closed rate limit, bcrypt 12, uniform auth-error responses, per-app tenant scope on `canonical-api`); standards captured in [SECURITY-PATTERNS.md](SECURITY-PATTERNS.md). The **Intake module** (`/core/intake`) is live behind login, routing every write through the per-tenant `intake-commit` orchestrator. Earlier `src/modules/tender-pipeline/` scaffolding is stale exploration; the `jobs` module was deleted in Phase 2.B.7. See [docs/ARCHITECTURE-V2.md](docs/ARCHITECTURE-V2.md) for the full closed-out phase plan and [docs/FIELD-UNIFICATION-PLAN.md](docs/FIELD-UNIFICATION-PLAN.md) for the next planned arc (collapse three Field deploys into one shell-mounted module).

**Design:** see `EQ-SHELL-DESIGN.md` in [Milmlow/eq-field-app](https://github.com/Milmlow/eq-field-app/blob/demo/EQ-SHELL-DESIGN.md). All Q1-Q10 locked.

## Stack

- **Vite + React 19 + TypeScript** — build tooling, framework, language.
- **React Router v6** — client-side routing.
- **@supabase/supabase-js** — canonical Supabase client (service-role on Netlify functions).
- **bcryptjs** — PIN hashing for shell-login.
- **Netlify Functions (v2 / Request-Response API)** — `shell-login`, `verify-shell-session`, `mint-iframe-token`.

## Companion infrastructure

| Resource | Identifier | Purpose |
|---|---|---|
| Supabase project | `eq-canonical` (id: `jvknxcmbtrfnxfrwfimn`, region `ap-southeast-2`) | **Control plane + shared storage** (post Phase 2.B.7, 2026-05-25). Holds `shell_control` (tenants, users, module_entitlements, audit_log, rate_limit_buckets, tenant_routing, pin_reset_tokens) + auth. Storage buckets (`licence-photos`, `certificates`, `tenant-<uuid>`) are deliberately shared on this project — tenant isolation enforced via storage RLS reading `app_metadata.tenant_id` from the JWT. The `app_data` schema is dropped. Surviving schemas: auth, extensions, graphql, graphql_public, public, realtime, **shell_control**, storage, supabase_migrations, vault. |
| Supabase project | `eq-canonical-internal` (id: `zaapmfdkgedqupfjtchl`, region `ap-southeast-2`) | **EQ tenant data plane** — active, holds all EQ operational entities under `app_data` schema. Routing row `active`. |
| Supabase project | `sks-canonical` (id: `ehowgjardagevnrluult`, region `ap-southeast-2`) | **SKS tenant data plane** — active, holds all SKS operational entities under `app_data` schema. Routing row `active`. |
| GitHub repo | `eq-solutions/eq-shell` (this) | Shell source. |
| Netlify project | `eq-shell` (id: `a3473f83-7c82-4f1e-872d-aa96eaa55172`) | Builds + hosts the shell. |
| Custom domains | `core.eq.solutions` (primary) | Each tenant gets a specific domain alias registered on the Netlify project. `*.eq.solutions` wildcard isn't accepted by Netlify on external DNS — Cloudflare wildcard CNAME resolves, but Netlify only serves explicitly-registered subdomains. See `docs/runbooks/onboard-trial-tenant.md` for the per-tenant onboarding pattern. |

## Phase plan

| Phase | Goal | Status |
|---|---|---|
| 1.A | Scaffolding — repo, Supabase, Netlify | Shipped |
| 1.B | Wire-up — shell-login, verify-shell-session, mint-iframe-token functions; React shell with login + tenant-home + iframe-Field route | Shipped |
| 1.C | Field-side — `?sh=` URL hash handler on `eq-field-app/demo` | Shipped (PR #106 on eq-field-app) |
| 1.D | End-to-end smoke (browser flow verified against `core.eq.solutions`) | Shipped 2026-05-19 |
| 1.E | Consolidation — drop `eq-shell-control`, single `eq-canonical` Supabase for the EQ tenant; iframe headers loosened on EQ Field | Shipped 2026-05-19 |
| 1.F | Unified Identity — 5-tier `eq_role` enum + `is_platform_admin` flag, session cookie + Supabase JWT carry both (`app_metadata` claims), `useCan()` + `<Gate>` + closed-union `PermKey`, on-demand `/.netlify/functions/mint-supabase-jwt`, admin invite + edit flow, Field iframe bridge carries the new fields. RLS swept from `user_metadata` to `app_metadata` across 13 canonical entity tables + intake spine + 3 RPC functions. | 2026-05-20 |
| 1.G | **Shell-side Field tenant picker** at `/core/field`. Shell mints the iframe token with the chosen Field organisation slug (`eq` / `demo-trades` / `melbourne`); Field cross-checks the slug against the iframe URL's `?tenant=` param and rejects mismatches. Three dev-loop fixes landed alongside: session cookie `Domain` now scopes per request host (works on previews + localhost), Netlify env vars confirmed scoped to all deploy contexts, and `scripts/smoke-preview.sh` catches future env regressions. Field-side companion (CSP `frame-ancestors` broadened for preview hosts) is eq-field PR #125. | 2026-05-23 |
| 2.A | **Intake module live** at `/core/intake` (drop CSV → map → validate → commit via the `@eq/*` engine; SimPRO fixtures validated end-to-end through parser + customer/contact/site mapping + validation). Writes route only through the `eq_intake_commit_batch` SECURITY DEFINER RPC; RLS predicates read `app_metadata.tenant_id`. | Shipped 2026-05-19 |
| 2.B | **Per-tenant data plane migration** — split `app_data` out of shared `eq-canonical` into per-tenant Supabase projects; `shell_control.tenant_routing` with AES-256-GCM-encrypted service-role keys; `canonical-api` service-to-service surface; per-tenant schema migration runner; full EQ + SKS data sync; intake-commit orchestrator + per-tenant RPCs for all 5 intake modules (cards / service / quotes / core / field); Cards mobile cutover; Supabase auth hook injecting `tenant_id` into JWT; shared `app_data` dropped from `eq-canonical`. | **Shipped 2026-05-25** |
| Sec.1+2 | **Security audit Blocks 1 + 2** — CSP + 5 security headers, `EQ_SECRET_SALT` fail-loud guard, rate-limit fail-closed, bcrypt 12, phone-OTP env-gated, uniform error responses on reset flows, per-app tenant scope on `canonical-api`, [SECURITY-PATTERNS.md](SECURITY-PATTERNS.md) reference doc. | **Shipped 2026-05-25** |
| 3+ | **Field unification** ([FIELD-UNIFICATION-PLAN.md](docs/FIELD-UNIFICATION-PLAN.md)) — collapse three Field deploys (EQ Field demo, EQ Field advanced, SKS NSW Labour) into one shell-mounted module backed by the per-tenant data plane. F1 (skeleton + routing) blocked on Royce's SKS prestart/toolbox port landing first. Then per-surface lift: roster, schedule, leave, tenders, audits, prestarts, toolbox talks. | Planned |
| 4 | EQ Field standalone deploys (both `eq-solves-field` and `sks-nsw-labour`) + their Supabase instances decommissioned, once every surface has a shell replacement | Long-term |

## Development

This repo uses **pnpm** (9.15.9) and depends on seven `@eq/*` workspace packages that originate in the `eq-solves-intake` repo. They are **vendored** in-tree at `./eq-intake/eq-platform/packages/` (not a git submodule). The vendored copy is the source of truth for what eq-shell consumes; updates happen by re-vendoring (see "Updating the vendored packages" below).

> **Why vendored, not a submodule:** `eq-solves-intake` is a private repo and Netlify's build environment doesn't have credentials to clone private submodules. Vendoring removes the cross-repo coupling entirely — Netlify clones one repo and builds. The trade-off is that updates to eq-intake require a manual re-vendor step.

### Cloning

```bash
git clone https://github.com/eq-solutions/eq-shell.git
cd eq-shell
pnpm install
```

### Day-to-day

```bash
pnpm install
pnpm run dev          # vite dev server (browser only — functions need netlify dev)
pnpm run build        # builds the @eq/* workspace packages, then tsc -b + vite build
pnpm run build:packages  # just rebuild the @eq/* dists (rarely needed manually)
pnpm run preview      # serve the built bundle
```

The `build` script first builds every workspace package in `eq-intake/eq-platform/packages/` (each emits a `dist/` via tsup or vite), then runs `tsc -b && vite build` for the shell. Skipping `build:packages` causes the shell's tsc step to error out with `Cannot find module '@eq/ai'` etc. because the packages' `package.json` entry points (`./dist/index.js`) are gitignored.

### Full local auth flow (Vite + Netlify Functions on one origin)

`pnpm dev` is fine for UI work, but the login / iframe-handshake path goes through Netlify Functions and won't run without them. `netlify dev` boots Vite *and* the Functions emulator on the same origin (port 8888) so the cookie + redirect flow behaves like production.

**netlify-cli is not a project devDep** — install it however you prefer:

```bash
npm install -g netlify-cli       # once, globally (recommended)
pnpx netlify-cli@^26 dev          # or one-off, no install
```

The `[dev]` block in `netlify.toml` pins the wiring (Vite on `targetPort=5173`, proxied on `port=8888`).

**Workflow:**

1. Copy `.env.example` to `.env` and fill in real values (Supabase, `EQ_SECRET_SALT`, `SUPABASE_JWT_SECRET`, plus optional Sentry/PostHog/Clarity DSNs). `.env` is gitignored.
2. Run `netlify dev` and open <http://localhost:8888>.
3. Log in as `dev@eq.solutions` / PIN `1234`.

Quick liveness check: `curl -i http://localhost:8888/.netlify/functions/verify-shell-session` should return `401 {"valid":false}`.

### Updating the vendored packages

When eq-intake's `overnight-review-2026-05-19` branch (or whichever branch we're tracking) advances:

```bash
# Replace the vendored tree with the latest eq-intake/eq-platform/
rm -rf eq-intake/eq-platform/packages
cp -r ../eq-intake/eq-platform/packages eq-intake/eq-platform/
# Strip any node_modules, dist, and src/generated that came along
find eq-intake -type d \( -name node_modules -o -name dist -o -path '*/src/generated' \) -prune -exec rm -rf {} +
pnpm install
pnpm run build   # sanity check
git add eq-intake
git commit -m "Re-vendor eq-intake/eq-platform to <date or sha>"
```

This is a manual process today. If re-vendoring becomes frequent, the next step is either (a) flip eq-solves-intake to public so Netlify can clone it as a submodule, (b) configure a GitHub deploy key on the Netlify build for submodule access, or (c) publish the `@eq/*` packages to npm under a private scope.

## Required environment variables (Netlify)

These must be set on the `eq-shell` Netlify project before functions run successfully:

| Variable | Source | Notes |
|---|---|---|
| `EQ_SECRET_SALT` | **Same value as eq-solves-field** | HMAC key for session cookies AND the iframe-handoff token. The iframe handshake breaks if this drifts from EQ Field's. |
| `SUPABASE_URL` | eq-canonical project URL | `https://jvknxcmbtrfnxfrwfimn.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → eq-canonical → Project settings → API keys | Service-role key; bypasses RLS. Never expose client-side. |
| `SUPABASE_JWT_SECRET` | Supabase dashboard → eq-canonical → Project settings → API → JWT Settings → JWT Secret | Used by `_shared/supabase-jwt.ts` + `mint-supabase-jwt` to sign short-lived (15min) tokens the browser uses to talk to Supabase directly. DISTINCT from `SUPABASE_SERVICE_ROLE_KEY`. Phase 1.F. |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` | Build-time exposed to the browser. Safe — public URL. |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → eq-canonical → Project settings → API keys (anon, public) | Build-time exposed to the browser. RLS is the gate, not the key. |
| `EQ_EMAIL_PROVIDER` *(optional)* | `resend` / `sendgrid` / etc. | Phase 1.F. Unset = log-only fallback (invite emails appear in Netlify Functions log only; admin pastes the URL manually). Set to a provider name + add its API key when real email delivery lands. |
| `TENANT_ROUTING_MASTER_KEY` | 32-byte hex (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | AES-256-GCM master key for service-role keys stored in `shell_control.tenant_routing`. Phase 2.B. Rotate annually or on suspected compromise. |
| `CANONICAL_API_KEY_SHELL` | random | Bearer for internal Shell-side calls to `/.netlify/functions/canonical-api`. Phase 2.B.3. |
| `CANONICAL_API_KEY_QUOTES` | random | Bearer for `quotes.eq.solutions` to call canonical-api. Phase 2.B.3. |
| `CANONICAL_API_KEY_SERVICE` | random | Bearer for `eq-solves-service` to call canonical-api. Phase 2.B.3. |
| `CANONICAL_API_KEY_FIELD` | random | Bearer for `eq-solves-field` to call canonical-api. Phase 2.B.3. |
| `CANONICAL_API_KEY_CARDS` | random | Bearer for `eq-cards` to call canonical-api. Phase 2.B.3. |

## Auth contract

Cookie name: `eq_shell_session`. HttpOnly, Secure, SameSite=Lax, 7 day Max-Age.

**Domain is set per request host** (Phase 1.G, 2026-05-23) — `Domain=.eq.solutions` only when the function's `Host` header is `eq.solutions` or any subdomain. Off-domain hosts (deploy previews on `*.netlify.app`, `localhost` under `netlify dev`) omit the `Domain` attribute, scoping the cookie to the exact origin that set it. Production behaviour unchanged; previews + local dev finally have a working cookie. See `netlify/functions/_shared/cookie.ts`.

**Session cookie payload (Phase 1.F):** `{ user_id, tenant_id, role: EqRole, is_platform_admin: boolean, exp }`. `role` is one of `manager | supervisor | employee | apprentice | labour_hire`. `is_platform_admin` is the EQ Solutions internal cross-tenant flag.

**Supabase JWT shape (Phase 1.F):**

```ts
{
  sub: user_id,
  aud: 'authenticated',
  role: 'authenticated',          // Postgres role slot, NOT the EQ tier
  app_metadata: {
    tenant_id: string,
    eq_role: EqRole,
    is_platform_admin: boolean
  },
  iat, exp                        // 15min TTL default
}
```

RLS policies on `eq-canonical` read `auth.jwt() -> 'app_metadata' ->> 'tenant_id'` for tenant scope, swept from `user_metadata` to `app_metadata` in migration `2026_05_20_phase_1f_unified_identity`.

| Endpoint | Method | Purpose | Body / response |
|---|---|---|---|
| `/.netlify/functions/shell-login` | POST | Email + PIN login | `{ email, pin } → 200 { valid: true, user, tenant, entitlements, supabase_jwt } + Set-Cookie` or `200 { valid: false }`. `user` carries `role` + `is_platform_admin` (Phase 1.F). |
| `/.netlify/functions/verify-shell-session` | GET | Hydrate session from cookie | `200 { valid: true, user, tenant, entitlements, supabase_jwt }` or `401 { valid: false }`. Re-mints `supabase_jwt` on every call. |
| `/.netlify/functions/mint-supabase-jwt` | POST | On-demand fresh Supabase JWT (for Cards Flutter, external modules) | `200 { token, exp }` or `401 { valid: false }`. Optional `?ttl=<seconds>` (clamped [60, 900]). |
| `/.netlify/functions/mint-iframe-token` | POST | Mint 60s HMAC for EQ Field iframe (chosen Field tenant in body) | `{ tenant_slug } → 200 { token, tenant_slug }`, or `400 { error, allowed: [...] }` on invalid/missing slug, or `401 { valid: false }` on missing session. Auth check runs **before** body validation so unauthenticated callers can't probe the tenant allow-list. Phase 1.F payload (`eq_role` + `is_platform_admin`) preserved; Phase 1.G adds `tenant_slug` to the signed payload — Field cross-checks against the iframe URL's `?tenant=` param and rejects mismatches with a `tenant-mismatch` postMessage. |
| `/.netlify/functions/invite-user` | POST | Admin invites a user | `{ email, role, entitlements? } → 200 { ok: true, invite_id, invite_url, email_delivered }`. Requires manager OR platform_admin. |
| `/.netlify/functions/accept-invite` | POST | Public — set PIN + sign in | `{ invite_token, pin } → 200 { valid: true, user, tenant, entitlements, supabase_jwt } + Set-Cookie`. Public endpoint; invite token IS the authentication. |
| `/.netlify/functions/edit-user` | POST | Admin edits a user (role / active / entitlements) | `{ user_id, patch } → 200 { ok: true, user }`. Requires manager OR platform_admin. Self-edit forbidden. |

EQ Field validates the minted iframe token via its existing `/.netlify/functions/verify-pin` (action `verify-shell-token`), shipped in PR #106 on `eq-field-app/demo`. Field doesn't read the new `eq_role` / `is_platform_admin` fields yet — that's a separate follow-up PR on `Milmlow/eq-field-app`.

## Repository layout

```
.
├── netlify/
│   └── functions/
│       ├── _shared/
│       │   ├── email.ts              # outbound email helper (log-only until EQ_EMAIL_PROVIDER set)
│       │   ├── sentry.ts             # withSentry() wrapper
│       │   ├── cookie.ts             # session cookie builder; scopes Domain per request host (Phase 1.G)
│       │   ├── supabase.ts           # service-role client + CanonicalUser/Tenant types + EqRole
│       │   ├── supabase-jwt.ts       # mints Supabase-format JWTs with app_metadata
│       │   └── token.ts              # session cookie + iframe HMAC helpers (ShellTokenPayload now carries tenant_slug)
│       ├── shell-login.ts
│       ├── verify-shell-session.ts
│       ├── mint-iframe-token.ts
│       ├── mint-supabase-jwt.ts      # Phase 1.F — on-demand JWT minter
│       ├── invite-user.ts            # Phase 1.F — admin invite
│       ├── accept-invite.ts          # Phase 1.F — public PIN-set + first login
│       └── edit-user.ts              # Phase 1.F — admin edit/deactivate
├── src/
│   ├── modules/                      # lazy chunks: cards, intake/, quotes, service, tender-pipeline
│   │   └── intake/
│   │       ├── index.tsx             # IntakeModule wrapper (Gate + createSupabaseClient)
│   │       └── permissions.ts        # per-module perm keys (intake.view/.import/.commit)
│   ├── pages/                        # LoginPage, TenantHome, FieldIframe (Phase 1.G picker),
│   │                                 # ComingSoon, AcceptInvite, AdminInviteUser, AdminUserList, AdminEditUser
│   ├── permissions.ts                # useCan() hook (Phase 1.F)
│   ├── permissions/
│   │   ├── Gate.tsx                  # <Gate perm="..."> component
│   │   └── matrix.ts                 # closed-union PermKey + per-role MATRIX
│   ├── lib/
│   │   └── supabaseJwt.ts            # client cache + createSupabaseClient()
│   ├── App.tsx                       # router + RequireSession + ModuleGate
│   ├── brand.tsx                     # BrandProvider + useBrand
│   ├── session.ts                    # SessionContext + EqRole + useSession + moduleEnabled
│   └── main.tsx
├── docs/
│   └── runbooks/
│       ├── deploy-preview-env.md     # which env vars must be scoped to Deploy Previews + how to verify (Phase 1.G)
│       ├── sentry-setup.md
│       ├── posthog-setup.md
│       └── clarity-setup.md
├── scripts/
│   └── smoke-preview.sh              # black-box smoke for /shell-login + /verify-shell-session + /mint-iframe-token
├── netlify.toml
└── README.md
```

## Pre-merge preview smoke

Every eq-shell PR gets a Netlify deploy preview at `https://deploy-preview-<N>--eq-shell.netlify.app`. The critical functions can be smoked in one shot:

```bash
./scripts/smoke-preview.sh https://deploy-preview-15--eq-shell.netlify.app
```

Passes on production; fails (with a pointer at `docs/runbooks/deploy-preview-env.md`) when server-side env vars aren't scoped to the Deploy Previews context. Run after opening any PR that touches auth, env wiring, or canonical DB access.

## Conventions

- **TypeScript strict mode** — no `any` without justification.
- **Functional components + hooks** — no class components.
- **Lazy-load every module** (`React.lazy()`) — disabled tenants never pay the bandwidth cost. Q5 lock from the design doc.
- **Client-side Supabase reads via the minted JWT (Phase 1.F onward).** RLS on canonical reads from `app_metadata.tenant_id`; the browser uses `src/lib/supabaseJwt.ts` (`createSupabaseClient()` + `getSupabaseJwt()`) which auto-refreshes via `/.netlify/functions/mint-supabase-jwt`. Service-role client stays inside Netlify functions only.
- **`useCan()` + `<Gate>` for every gated UI surface** — never read `session.user.role` directly to make a permission decision. Type-level invariant: `PermKey` is a closed union; typing `useCan('module.does_not_exist')` fails to compile.
- **Vendor branding lives in code, not assets** — brand objects (color, logo URL, name) come from the canonical Supabase per-tenant; the codebase has no `sks/` or `eq/` asset folders.

## Related repos

- [Milmlow/eq-field-app](https://github.com/Milmlow/eq-field-app) — the existing vanilla-JS EQ Field. Loaded via iframe in Phase 1 / 2; gradually migrated under this shell in Phase 3+.
- [eq-solutions/eq-context](https://github.com/eq-solutions/eq-context) — substrate / cross-project context store.
