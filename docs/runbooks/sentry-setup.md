# Sentry — eq-shell runbook

## What it captures

- **Browser** (`@sentry/react`): uncaught React errors, unhandled promise rejections, route-load failures, and ~10% of normal sessions for performance traces. Session replay records 10% of normal sessions and 100% of any session that hits an error.
- **Server** (`@sentry/node` on Netlify Functions): uncaught throws from `shell-login`, `verify-shell-session`, and `mint-iframe-token`, wrapped via the shared `withSentry()` helper at `netlify/functions/_shared/sentry.ts`. Throws are reported with tags `netlify_function`, `method`, and the request URL as extra context.

## Project shape

| Setting | Value |
|---|---|
| Org slug | `eq-solutions` |
| Project slug | `eq-shell` |
| Platform | JavaScript / React (browser), Node.js (server) — one project covers both |
| Alert routing | `dev@eq.solutions` |
| MCP URL | `https://mcp.sentry.dev/mcp/eq-solutions/eq-shell` |

## Wiring it on

Set the following on the `eq-shell` Netlify project (Site settings → Environment variables):

| Variable | Scope | Notes |
|---|---|---|
| `VITE_SENTRY_DSN` | Build (exposed to browser) | DSN from Sentry → Settings → Projects → eq-shell → Client Keys |
| `SENTRY_DSN` | Function | Usually the same DSN as the browser. Server-side capture uses this. |
| `VITE_SENTRY_ENVIRONMENT` | Build (optional) | Defaults to `import.meta.env.MODE`. Set to `production`, `branch-deploy`, etc. if you want explicit values. |
| `SENTRY_ENVIRONMENT` | Function (optional) | Defaults to `NETLIFY_CONTEXT` (`production` / `deploy-preview` / `branch-deploy`). |
| `VITE_SENTRY_RELEASE` | Build (optional) | Release tag — typically the git SHA. Useful for `release:` filters in Sentry. |
| `SENTRY_RELEASE` | Function (optional) | Defaults to `COMMIT_REF` set by Netlify. |
| `SENTRY_TRACES_SAMPLE_RATE` | Function (optional) | Defaults to `0.1`. |

If `VITE_SENTRY_DSN` / `SENTRY_DSN` is missing, the integration silently no-ops — a single info-level log line on cold start confirms the SDK saw no DSN. The app continues to work normally.

## Identity

`identifyUser(userId, { tenant, role, email })` is called from `SessionProvider` (`src/App.tsx`) once `verify-shell-session` hydrates the canonical session. Errors in Sentry are tagged with `tenant` and `role` so Royce can slice issues by tenant. `resetUser()` clears identity on logout or session loss.

## Alert routing

In Sentry → Settings → Project `eq-shell` → Alerts:

1. **Issue alert** (default): "New issue created" → email `dev@eq.solutions`.
2. **Performance alert** (optional, once traffic warrants): p95 transaction duration over a 10-minute window — same email destination.

The shared dev inbox forwards into Royce's normal email; no Slack/Teams wiring required for Phase 1.

## Verifying

After setting the DSN in Netlify:

1. Trigger a redeploy.
2. Open the deployed app, click "Throw test error" if Royce wires a debug button, or paste `throw new Error('sentry-smoke');` in DevTools.
3. Check Sentry → eq-shell project → Issues. The event should appear within ~30 seconds with the user/tenant tags attached.
4. For server: hit a Netlify Function with a malformed payload that triggers an unhandled throw, then check the same Issues view.

## Related files

- `src/observability.ts` — browser init + `identifyUser` / `resetUser`.
- `src/main.tsx` — calls `initObservability()` before React mounts.
- `netlify/functions/_shared/sentry.ts` — `withSentry()` wrapper used by every Netlify Function in this repo.
