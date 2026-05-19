# PostHog — eq-shell runbook

## What it captures

- **Page views + page leaves** (auto-captured by `posthog-js` browser SDK).
- **Custom events** that any module emits via `posthog.capture('event_name', { ... })`. Phase 1 doesn't emit any custom events yet — Phase 2 modules (Tender Pipeline, etc.) will add them as needed.
- **Identified users** via `posthog.identify(userId, traits)` from the `SessionProvider`, with the canonical user id as the distinct_id and tenant + role + email as person properties. `person_profiles: 'identified_only'` is set so anonymous browsing doesn't burn paid PostHog person quota.
- **Tenant groups** — `posthog.group('tenant', slug)` is called alongside identify so every event can be sliced by tenant in PostHog dashboards.

## Project shape

| Setting | Value |
|---|---|
| Instance | `https://eu.i.posthog.com` (EU residency) |
| Project | One per app — create `eq-shell` in PostHog |
| Per-env keys | Production gets its own project key. Dev / branch-deploy / deploy-preview share a separate non-prod key so test traffic doesn't pollute production analytics. |

## Wiring it on

Set on the `eq-shell` Netlify project:

| Variable | Scope | Notes |
|---|---|---|
| `VITE_POSTHOG_KEY` | Build | Project API key from PostHog → Settings → Project → API key. Use the production key on `production` context; use the non-prod key on `deploy-preview` and `branch-deploy` (Netlify lets you scope env vars per context). |
| `VITE_POSTHOG_HOST` | Build (optional) | Defaults to `https://eu.i.posthog.com`. Override only if Royce ever moves to the US instance. |

If `VITE_POSTHOG_KEY` is missing the SDK silently no-ops — one info-level log line on init confirms the SDK was skipped. The app continues to work normally.

## Identity + groups

`identifyUser(userId, { tenant, role, email })` from `src/observability.ts` runs once per session hydration:

- `posthog.identify(userId, { tenant, role, email })` — joins all subsequent events to the canonical user id.
- `posthog.group('tenant', tenant)` — attaches the tenant group so dashboards can be split by tenant.

`resetUser()` calls `posthog.reset()` on logout so post-logout events aren't attributed to the prior user.

## Dashboards / feature flags

Royce manages dashboards + feature flags in the PostHog UI. The shell doesn't reference any feature flags yet — when it starts to (Phase 2+), import `posthog` from `posthog-js` and use `posthog.isFeatureEnabled('flag-key')`. The init in `observability.ts` already handles the bootstrap.

## Verifying

After setting `VITE_POSTHOG_KEY` in Netlify:

1. Trigger a redeploy.
2. Open the deployed app, log in.
3. PostHog → Activity → Live events should show `$pageview` + `$identify` events for the logged-in user within seconds.

## Related files

- `src/observability.ts` — `initPostHog` + identify/group logic.
- `src/main.tsx` — calls `initObservability()` before React mounts.
- `src/App.tsx` — `SessionProvider` calls `identifyUser()` on session hydrate, `resetUser()` on logout.
