# eq-shell — CLAUDE.md

EQ Shell is the auth + nav hub at **core.eq.solutions**. It owns the session
cookie and hosts Cards / Field / Service / Quotes / Intake as either iframes
(Cards, Field, Service) or lazy React chunks (Intake, Quotes).

Read `README.md` first for architecture, phase plan, function endpoints, and
env vars. This file covers the rules that aren't obvious from the README —
violating them silently breaks production across multiple repos.

## Load-bearing facts

- **This is the auth hub for the entire EQ suite.** Cards, Field, and Service
  each trust an HMAC token Shell mints. A bug in `netlify/functions/_shared/token.ts`
  or any `mint-*-iframe-token.ts` breaks SSO across all of them, often silently.
- **`EQ_SECRET_SALT` is the shared HMAC key** across Shell, eq-solves-field,
  eq-cards, and eq-solves-service. All four Netlify deploys must hold the same
  value. If you rotate it on one, rotate it on all four in the same change.
  See README "Required environment variables".
- **Iframe handoff tokens are 60s TTL** — one-shot exchange, not session
  credentials. Don't extend the lifetime; treat clock skew between Netlify
  function hosts as ~5s worst case.
- **Production = `main` branch.** A push to `main` triggers Netlify auto-deploy
  to core.eq.solutions. Never push without explicit instruction from Royce
  (global CLAUDE.md rule).

## Don't touch without checking downstream

When you change anything in this list, also verify the downstream consumer:

| File / behaviour | Downstream that depends on it |
|---|---|
| `netlify/functions/_shared/token.ts` (`ShellTokenPayload`, `ServiceTokenPayload`) | eq-solves-field's `verify-pin.js` (action `verify-shell-token`), eq-solves-service's `/.netlify/functions/shell-auth` |
| `netlify/functions/mint-iframe-token.ts` | eq-solves-field iframe handoff (PR #106 on Milmlow/eq-field-app) |
| `netlify/functions/mint-service-iframe-token.ts` | eq-solves-service `/shell` route → `/api/shell-auth` |
| `netlify/functions/mint-cards-iframe-token.ts` | eq-cards Flutter web app (`CARDS_USE_SHELL_SSO=true`) |
| Session cookie shape in `_shared/token.ts` (`SessionPayload`) | Every Netlify function that calls `verifySessionToken` — login/logout/verify/mint-* all assume it |
| Supabase JWT shape in `_shared/supabase-jwt.ts` | All RLS policies on eq-canonical (read `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`) |

## Build + dev gotchas

- **`pnpm run build` (not `tsc -b`)** — the build script runs `build:packages`
  first because `@eq/*` workspace `dist/` folders are gitignored. Skipping it
  produces `Cannot find module '@eq/ai'` errors.
- **Auth flow needs `netlify dev`**, not `pnpm dev`. `netlify dev` proxies
  Vite on port 8888 alongside the Functions emulator on the same origin so
  the HttpOnly cookie + redirect flow works locally.
- **`eq-intake/eq-platform/packages/` is vendored, not a submodule.** Updates
  require a manual re-vendor (see README). Don't add it as a submodule —
  Netlify can't clone private submodules.
- **`pnpm-lock.yaml` is committed** — use pnpm 9.15.9 (pinned via
  `packageManager` field). Don't switch to npm/yarn.

## Auth / permissions rules

- **Never read `session.user.role` directly to gate UI.** Always use
  `useCan('module.action')` or `<Gate perm="module.action">`. `PermKey` is a
  closed union — typos fail to compile.
- **`app_metadata` is the source of truth** for `tenant_id`, `eq_role`,
  `is_platform_admin`. RLS reads from there (Phase 1.F sweep). Never write
  these to `user_metadata`.
- **Service-role Supabase client stays inside Netlify functions.** The browser
  gets a short-lived (15min) Supabase JWT via `/.netlify/functions/mint-supabase-jwt`,
  consumed through `src/lib/supabaseJwt.ts` (`createSupabaseClient()`). RLS is
  the gate, not the key.
- **`RequireSession` enforces tenant-slug match** on the URL. Don't bypass —
  it stops URL-guessing into another tenant's shell.
- **Iframe pages (`FieldIframe`, `CardsIframe`, `ServiceIframe`) mint a fresh
  token on mount.** Don't cache; the handshake is the contract.

## Canonical DDL governance — secure by default, open by exception

- **New tables are born CLOSED.** Per the 2026-06-07 default-privilege lockdown
  (`supabase/security/2026-06-07_default-privileges-*.sql`), `ALTER DEFAULT
  PRIVILEGES` on all three canonical planes — control (jvkn: `public` +
  `shell_control`), SKS (ehow: `public`), and EQ Field (zaap: `public`) — no
  longer grants `anon`/`authenticated` on freshly created tables. This replaced
  the old "open by default" posture that let `sks_quotes_*`,
  `sks_quotes_pricing_*`, and `tenant_role_overrides` ship anon-exposed until
  someone remembered to `REVOKE`. (One residual per plane: the `supabase_admin`
  grantor line needs the dashboard SQL editor — `postgres` can't alter it.)
- **Anon/authenticated access is now opt-in.** A new table that genuinely needs
  it must add an EXPLICIT `GRANT` **plus** an RLS policy in its own migration —
  never rely on a schema default. Bootstrap reads (login-page org lookup,
  module map, schema registry) stay in `INTENTIONAL_ANON_READS` in
  `scripts/check-tenant-drift.mjs` and are SELECT-only via policy.
- **`service_role` is the normal path.** Data tables are reached server-side
  via service-role functions or the per-user Supabase JWT against RLS — not via
  a standing anon/authenticated grant.
- **The drift gate still backstops this.** `scripts/check-tenant-drift.mjs`
  (anon-grant invariant) fails the build on any *new* anon-open table; the
  default-privilege change just stops new tables from being born that way in the
  first place. Run it (`--anon-only`) after any DDL that adds tables.

## Module convention

- Every new lazy React module: add `React.lazy()` import + `<ModuleGate
  module="X">` wrap + per-module `permissions.ts` declaring its perm keys.
- Cards, Field, Service are **iframe modules**, not lazy React chunks. Their
  routes render a `*Iframe` page component that mints the appropriate token
  and renders an `<iframe>` with the right `sandbox` attrs.
- `tender-pipeline/` module was removed 2026-05-23 — don't recreate it.

## When you need to verify production after a change

- Deploy preview smoke: `./scripts/smoke-preview.sh https://deploy-preview-<N>--eq-shell.netlify.app`
- Live: `curl -i https://core.eq.solutions/.netlify/functions/verify-shell-session`
  should return `401 {"valid":false}` for an unauthed request.
- Full SSO smoke needs a browser session — sign in at core.eq.solutions, click
  into /service or /cards or /field, confirm the iframe loads past the
  "Authorising…" state.

## MCPs available in this repo

Project-scoped MCPs are in `.mcp.json`:

- **Sentry** (`https://mcp.sentry.dev/mcp/eq-solutions`) — issue triage, alert
  rules. Project slug is `eq-shell` per global convention.

Netlify and Supabase MCPs are bundled at the user level — use them directly
for env vars, deploys, migrations.

## House style (from global ~/.claude/CLAUDE.md)

- EQ brand: Plus Jakarta Sans, `#3DA8D8` / `#2986B4` / `#EAF5FB` / `#1A1A2E`.
  No gradients, no shadows.
- User-facing copy is **plain English** — no architecture jargon
  (canonical / tenant / entity / module / schema) in UI labels, errors,
  buttons. See global CLAUDE.md "Voice".
- TypeScript strict — no `any` without justification.
- Default to writing no comments. WHY-only when added.
- Never delete files without explicit permission.
- **Icons: Lucide (`lucide-react`)** for all meaningful icons — alerts, status,
  actions. Don't use Unicode/emoji glyphs (`⚠ ✓ ✕`) for iconography; decorative
  typography (arrows, bullets) is fine. Scoped adoption — see `docs/adr-001-icons.md`
  (Cards stays on Material Icons; no blanket retrofit).
