# Sentry — setup runbook

Wired into the codebase 2026-05-18. **One thing left to do** before errors start flowing into a dashboard: procure a Sentry DSN and add 3 env vars to Netlify. Everything else (SDK install, instrumentation, source-map upload, test endpoint, alert hooks) is already merged.

## The 4 env vars to set in Netlify

Go to: Netlify → eq-solves-service → Site configuration → Environment variables → Add a variable.

| Var | Where to get it | Sensitivity |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Settings → Projects → eq-solves-service → Client Keys (DSN) | Browser-safe (it's a public ingest URL — Sentry's auth model accepts events from any DSN; abuse is rate-limited by the project's quota) |
| `SENTRY_DSN` | Same value as the public DSN | Server-only env, kept separate as a defence-in-depth pattern |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens → Create New Token → scope: `project:write` | **Secret.** Used only at build time for source-map upload. Never exposed to the browser. |
| `SENTRY_ORG` + `SENTRY_PROJECT` | Sentry org slug + project slug from the Sentry URL | Identifiers, not secrets — useful for the source-map upload step |

**Scopes for `SENTRY_AUTH_TOKEN`:** `project:read`, `project:releases`, `org:read`. The Sentry "Create Auth Token" UI suggests these by default for source-map upload.

## How to procure the DSN (5 min)

1. Sign in at https://sentry.io (or create a new account)
2. Create a new project: Platform = **Next.js**, name = `eq-solves-service`, team = your default
3. After creation, Sentry shows you the DSN — looks like `https://abc123def456@o1234567.ingest.sentry.io/1234567`
4. Copy this exact string into both `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` in Netlify
5. In Sentry → Settings → Auth Tokens → Create New Token. Scope: `project:write`. Copy into `SENTRY_AUTH_TOKEN` in Netlify
6. `SENTRY_ORG` = the part after `https://sentry.io/organizations/` in your dashboard URL. `SENTRY_PROJECT` = `eq-solves-service` (the slug you chose)

## How to verify it works

After setting the env vars, the next Netlify deploy uploads source maps + initialises the SDK. To confirm:

1. Sign in to the app at https://eq-solves-service.netlify.app
2. Visit https://eq-solves-service.netlify.app/api/sentry-test
3. Expect: a 500 error page (deliberate — see the route's code)
4. Within ~30 seconds, an event titled `[sentry-test] Deliberate error from /api/sentry-test` appears in the Sentry dashboard

If no event arrives:
- Check Netlify build logs for `[sentry] source map upload skipped:` warning lines (means `SENTRY_AUTH_TOKEN` is missing or scoped wrong)
- Check the browser network tab — Sentry events ship via a POST to your DSN's ingest URL on `sentry.io`. A 4xx response means the DSN is malformed; a 0/network error means it's right but blocked by an ad-blocker (use a clean browser session)
- Sentry's "Issues" tab in the dashboard takes ~10-30s to process the first event of a new project; refresh

## What gets captured automatically

After the DSN is live:

| Surface | Captures | Where |
|---|---|---|
| Client components (React) | Runtime errors, unhandled promise rejections, errors caught by App Router `error.tsx` boundaries | `instrumentation-client.ts` |
| Server components + route handlers + server actions | Errors thrown in any server-side code path | `sentry.server.config.ts` via `instrumentation.ts` |
| Edge runtime (`proxy.ts` MFA gate) | Errors in the edge middleware | `sentry.edge.config.ts` via `instrumentation.ts` |
| Source maps | Stack traces in the dashboard match committed source lines, not minified output | Build-time via `withSentryConfig` in `next.config.ts` |

## What's intentionally NOT captured

- **Traces** — `tracesSampleRate: 0` everywhere. Performance monitoring adds cost and noise; turn on when there's a specific perf question
- **Replays** — `replaysSessionSampleRate: 0`. Session replay is heavy and privacy-fraught (records the user's screen); enable only with explicit user/customer consent
- **Local dev errors** — `enabled: process.env.NODE_ENV === 'production'`. Sentry only fires on prod builds

## Alert setup

The Sentry MCP (`https://mcp.sentry.dev/mcp/eq-solutions/eq-solves-service`, wired at project scope) is the preferred tool for **investigating** Sentry data once events are flowing — search issues, fetch event details, look up teams/releases. It does **not** expose alert-rule creation tools (verified 2026-05-18 — the MCP surface is search/find/get only). For creating or editing alert rules, use the script below or the Sentry UI.

The Sentry org `eq-solutions` is on the **EU (Germany) region**, so all org-scoped REST API calls go to `https://de.sentry.io/api/0`, not `https://sentry.io/api/0`. The script defaults to the EU host; override via `$env:SENTRY_API_BASE` if the org ever migrates regions.

**Three rules currently live** on `eq-solves-service` (created 2026-05-18):

| ID | Name | Condition |
|---|---|---|
| 599698 | Issue affecting 5+ users in 1h | `EventUniqueUserFrequencyCondition` value=5, interval=1h. Catches real bugs hitting real users. |
| 599699 | Report run approaching 60s cap | `EventFrequencyCondition` value=1, interval=1h, filtered by `TaggedEventFilter` (key=`canary`, match=`eq`, value=`report_duration`) + `LevelFilter` match=`gte` level=30. Fires when the PR #147 report-duration canary surfaces. |
| 599700 | Resolved issue regressed | `RegressionEventCondition`. Catches the "I thought I fixed that" case. |

All three: `actionMatch=all`, `filterMatch=all`, `frequency=60` (action interval in minutes), `environment=null`. Action: `NotifyEmailAction` with `targetType=Team` and `targetIdentifier` = the team assigned to the project.

> **Why `Team`, not `Member`:** Sentry rejects `targetType=Member` for users whose project access comes from the org-owner role rather than team-based project membership ("This user is not part of the project."). Targeting the team avoids the quirk and is the more correct shape for an on-call alert anyway. The `eq-solutions` team currently contains only `dev@eq.solutions`, so the recipient list is unchanged in practice.

To recreate, edit, or extend:

[scripts/create-sentry-alerts.ps1](../../scripts/create-sentry-alerts.ps1) — needs `SENTRY_AUTH_TOKEN` in env with scopes `alerts:write` + `member:read` + `project:read`. Create the token at https://eq-solutions.sentry.io/settings/account/api/auth-tokens/ and **delete it as soon as the script finishes** — it's only needed for the one-shot run.

Default Sentry alerts are too noisy for a 2-tenant product. Tune as the user base grows.

## Cost expectations

- Free tier: 5,000 errors/month
- At current scale (2 tenants, ~10 active users): expect <100 errors/month
- If you start hitting 5k, the dashboard tells you which issue is dominating — usually one bug producing many duplicates. Fix → quota stops being a concern

## How to silence the test endpoint in the dashboard

If you don't want `/api/sentry-test` events counting toward quota or cluttering the issues list:
1. In Sentry → Issues, find the `[sentry-test]` issue
2. Click **Ignore** → "Until …" → forever
3. Future events from that path are dropped server-side

## What's already wired (don't redo)

- `@sentry/nextjs@^10.53.1` installed
- `instrumentation.ts` — server + edge runtime init via `register()` + `onRequestError`
- `instrumentation-client.ts` — client init + `onRouterTransitionStart` route tagging
- `sentry.server.config.ts`, `sentry.edge.config.ts` — runtime-specific Sentry.init calls
- `next.config.ts` wrapped with `withSentryConfig` for source-map upload
- `lib/env.ts` validates `NEXT_PUBLIC_SENTRY_DSN` as an optional URL
- `/api/sentry-test` route for verification
- Common noise filters: `PGRST116` (PostgREST not-found), `ResizeObserver loop`, `Failed to fetch`
- Three standard alert rules live on the project (IDs 599698 / 599699 / 599700 — see Alert setup above)
