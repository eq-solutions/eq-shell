# EQ Shell

Multi-module React shell for `*.eq.solutions` tenants. Hosts Cards / Intake / Quotes / Service / Field as lazy-loaded modules under one authenticated shell.

**Status:** Phase 1.E shipped (2026-05-19). End-to-end smoke test green: `core.eq.solutions` → login → tenant home → EQ Field iframe loads without PIN gate. Shell auth runs against `eq-canonical` (single canonical EQ Solutions DB). Phase 2 (Tender Pipeline import screen, built directly against `eq-canonical`'s intake/registry tables) is the active milestone.

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
| Supabase project | `eq-canonical` (id: `jvknxcmbtrfnxfrwfimn`, region `ap-southeast-2`) | Single canonical EQ Solutions DB — holds shell control tables (`tenants`, `users`, `module_entitlements`) **and** EQ tenant application data (customers, sites, schema registry, intake events, etc.). The earlier separate `eq-shell-control` was decommissioned 2026-05-19. |
| GitHub repo | `eq-solutions/eq-shell` (this) | Shell source. |
| Netlify project | `eq-shell` (id: `a3473f83-7c82-4f1e-872d-aa96eaa55172`) | Builds + hosts the shell. |
| Custom domains | `core.eq.solutions` (primary) | Each tenant gets a specific domain alias registered on the Netlify project. `*.eq.solutions` wildcard isn't accepted by Netlify on external DNS — Cloudflare wildcard CNAME resolves, but Netlify only serves explicitly-registered subdomains. See `HANDOFF-PHASE-1-A-B.md` for the rationale and per-tenant onboarding pattern. |

## Phase plan

| Phase | Goal | Status |
|---|---|---|
| 1.A | Scaffolding — repo, Supabase, Netlify | Shipped |
| 1.B | Wire-up — shell-login, verify-shell-session, mint-iframe-token functions; React shell with login + tenant-home + iframe-Field route | Shipped |
| 1.C | Field-side — `?sh=` URL hash handler on `eq-field-app/demo` | Shipped (PR #106 on eq-field-app) |
| 1.D | End-to-end smoke (browser flow verified against `core.eq.solutions`) | Shipped 2026-05-19 |
| 1.E | Consolidation — drop `eq-shell-control`, single `eq-canonical` Supabase for the EQ tenant; iframe headers loosened on EQ Field | Shipped 2026-05-19 |
| 2 | Build new shell modules (Tender Pipeline import first) directly against `eq-canonical`'s structure — `customers`, `sites`, `staff`, `eq_intake_events`, `eq_schema_registry`, `eq_export_*`. Not extending or migrating EQ Field's legacy data model. | Active |
| 3+ | Replace each EQ Field surface (roster, schedule, leave, tenders, audits, prestarts, toolbox talks) with a shell module backed by `eq-canonical`. Each surface goes live in the shell, then its EQ Field equivalent gets retired. | Long-term |
| 4 | EQ Field demo deploy + its `ktmjmdzqrogauaevbktn` Supabase decommissioned, once every surface has a shell replacement | Long-term |

## Development

```bash
npm install
npm run dev      # vite dev server (browser only — functions need netlify dev)
npm run build    # production build
npm run preview  # serve the built bundle

# To run the full stack including Netlify Functions locally:
npx netlify dev  # requires netlify-cli + linked project
```

## Required environment variables (Netlify)

These must be set on the `eq-shell` Netlify project before functions run successfully:

| Variable | Source | Notes |
|---|---|---|
| `EQ_SECRET_SALT` | **Same value as eq-solves-field** | HMAC key for session cookies AND the iframe-handoff token. The iframe handshake breaks if this drifts from EQ Field's. |
| `SUPABASE_URL` | eq-canonical project URL | `https://jvknxcmbtrfnxfrwfimn.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → eq-canonical → Project settings → API keys | Service-role key; bypasses RLS. Never expose client-side. |

## Auth contract

Cookie name: `eq_shell_session`. Domain: `.eq.solutions`. HttpOnly, Secure, SameSite=Lax, 7 day Max-Age.

| Endpoint | Method | Purpose | Body / response |
|---|---|---|---|
| `/.netlify/functions/shell-login` | POST | Email + PIN login | `{ email, pin } → 200 { valid: true, user, tenant, entitlements } + Set-Cookie` or `200 { valid: false }` |
| `/.netlify/functions/verify-shell-session` | GET | Hydrate session from cookie | `200 { valid: true, user, tenant, entitlements }` or `401 { valid: false }` |
| `/.netlify/functions/mint-iframe-token` | POST | Mint 60s HMAC for EQ Field iframe | `200 { token }` or `401 { valid: false }` |

EQ Field validates the minted token via its existing `/.netlify/functions/verify-pin` (action `verify-shell-token`), shipped in PR #106 on `eq-field-app/demo`.

## Repository layout

```
.
├── netlify/
│   └── functions/
│       ├── _shared/            # token + Supabase helpers (not deployed as functions)
│       ├── shell-login.ts
│       ├── verify-shell-session.ts
│       └── mint-iframe-token.ts
├── src/
│   ├── modules/                # lazy chunks for Cards / Intake / Quotes / Service / Tender Pipeline
│   ├── pages/                  # LoginPage, TenantHome, FieldIframe, ComingSoon
│   ├── App.tsx                 # router + RequireSession + ModuleGate
│   ├── brand.tsx               # BrandProvider + useBrand
│   ├── session.ts              # SessionContext + useSession + moduleEnabled
│   └── main.tsx
├── netlify.toml
└── README.md
```

## Conventions

- **TypeScript strict mode** — no `any` without justification.
- **Functional components + hooks** — no class components.
- **Lazy-load every module** (`React.lazy()`) — disabled tenants never pay the bandwidth cost. Q5 lock from the design doc.
- **No client-side Supabase reads in Phase 1** — everything goes through Netlify functions with the service-role key. Direct client reads land in Phase 2+ once per-user JWT-based RLS is wired (see migration `2026_05_19_shell_control_plane` on `eq-canonical`).
- **Vendor branding lives in code, not assets** — brand objects (color, logo URL, name) come from the canonical Supabase per-tenant; the codebase has no `sks/` or `eq/` asset folders.

## Related repos

- [Milmlow/eq-field-app](https://github.com/Milmlow/eq-field-app) — the existing vanilla-JS EQ Field. Loaded via iframe in Phase 1 / 2; gradually migrated under this shell in Phase 3+.
- [eq-solutions/eq-context](https://github.com/eq-solutions/eq-context) — substrate / cross-project context store.
