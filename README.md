# EQ Shell

Multi-module React shell for `*.eq.solutions` tenants. Hosts Cards / Intake / Quotes / Service / Field as lazy-loaded modules under one authenticated shell.

**Status:** Phase 1.A scaffold (2026-05-18). Vite + React + TypeScript skeleton only — no business logic yet.

**Design:** see `EQ-SHELL-DESIGN.md` in [Milmlow/eq-field-app](https://github.com/Milmlow/eq-field-app/blob/demo/EQ-SHELL-DESIGN.md). All Q1-Q10 locked.

## Stack

- **Vite + React 18 + TypeScript** — build tooling, framework, language.
- **React Router v6** (to be added Phase 1.B) — client-side routing.
- **@supabase/supabase-js** (to be added Phase 1.B) — client for the canonical Supabase.
- **Netlify** — hosting + serverless functions for `shell-login` / `verify-shell-session` / `mint-iframe-token`.

## Companion infrastructure

| Resource | Identifier | Purpose |
|---|---|---|
| Supabase project | `eq-shell-control` (id: `hxwitoveffxhcgjvubbd`, region `ap-southeast-2`) | Canonical EQ-corporate tables: `tenants`, `users`, `module_entitlements`, `branding`. |
| GitHub repo | `eq-solutions/eq-shell` (this) | Shell source. |
| Netlify project | `eq-shell` (to be created Phase 1.A finish) | Builds + hosts the shell at `*.eq.solutions`. |
| Custom domain | `*.eq.solutions` (pending DNS) | Wildcard subdomain for tenants (`sks.eq.solutions`, `melbourne.eq.solutions`, etc.). |

## Phase plan

| Phase | Goal | Status |
|---|---|---|
| 1.A | Scaffolding — repo, Supabase, Netlify | In progress |
| 1.B | Wire-up — shell-login, verify-shell-session, mint-iframe-token functions; React shell with login + tenant-home + iframe-Field route | Next |
| 1.C | Field-side — `?sh=` URL hash handler in `eq-field-app/scripts/auth.js` (small PR against `eq-field-app/demo`) | Pending |
| 1.D | End-to-end smoke | Pending |
| 2 | Tender Pipeline migration to React (the adoption wedge) | After Phase 1 |
| 3+ | Surface-by-surface EQ Field migration | Long-term |
| 4 | EQ Field deploy decommissioned | Long-term |

## Development

```bash
npm install
npm run dev      # vite dev server
npm run build    # production build
npm run preview  # serve the built bundle
```

## Conventions

- **TypeScript strict mode** — no `any` without justification.
- **Functional components + hooks** — no class components.
- **Co-locate by feature** — `src/modules/<module>/` for each module's routes/components/hooks; `src/shared/` for cross-cutting code.
- **Vendor branding lives in code, not assets** — brand objects (color, logo URL, name) come from the canonical Supabase per-tenant; the codebase has no `sks/` or `eq/` asset folders.

## Related repos

- [Milmlow/eq-field-app](https://github.com/Milmlow/eq-field-app) — the existing vanilla-JS EQ Field. Loaded via iframe in Phase 1 / 2; gradually migrated under this shell in Phase 3+.
- [eq-solutions/eq-context](https://github.com/eq-solutions/eq-context) — substrate / cross-project context store.
