# Microsoft Clarity — eq-shell runbook

## What it captures

- **Session replays** — every browser session recorded as a scrubbable timeline (clicks, scrolls, rage-clicks, dead-clicks, JS errors).
- **Heatmaps** — click + scroll + area heatmaps generated per URL.
- **No custom events required** — Clarity auto-instruments the whole DOM. Useful out of the box; no per-app instrumentation work.

Clarity ships no npm SDK. The integration is a one-line `<script>` tag injection — `src/observability.ts` builds and appends it at runtime when `VITE_CLARITY_PROJECT_ID` is set.

## Project shape

| Setting | Value |
|---|---|
| Account | Royce's Microsoft / Clarity account |
| Project | One per app — create `eq-shell` in the Clarity dashboard |
| Project ID | Short alphanumeric string visible at the end of the Clarity dashboard URL (e.g. `https://clarity.microsoft.com/projects/view/xxxxxxxxxx`) |

## Wiring it on

Set on the `eq-shell` Netlify project:

| Variable | Scope | Notes |
|---|---|---|
| `VITE_CLARITY_PROJECT_ID` | Build | The project ID from Clarity → Settings → Setup. Browser-only — Clarity is a frontend-only product. |

If `VITE_CLARITY_PROJECT_ID` is missing the integration silently no-ops — one info-level log line on init confirms the SDK was skipped.

## Identity

`identifyUser(userId, { tenant, role, email })` from `src/observability.ts` calls `clarity('identify', userId, ...)` and tags the session with `tenant` + `role` via `clarity('set', ...)`. Filtering in the Clarity dashboard supports those custom tags.

## What lands where

Clarity sees the raw DOM of every page. Two operational notes:

1. **PII**: input fields, by default, are masked. Confirm the PIN input on `LoginPage` is `type="password"` so Clarity's automatic masking applies. Sensitive form fields elsewhere in the shell (Phase 2+ modules) should follow the same convention.
2. **Iframes**: the EQ Field iframe at `/:tenantSlug/field` is a cross-origin embed (`eq-solves-field.netlify.app`). Clarity records the parent frame only — the iframe content is not captured here. If Royce wants Field session replay too, Clarity must be installed independently on the `eq-solves-field` deploy.

## Alert routing

Clarity has no alerting; it's a passive replay product. Royce reviews replays + heatmaps directly in the Clarity dashboard.

## Verifying

After setting `VITE_CLARITY_PROJECT_ID` in Netlify:

1. Trigger a redeploy.
2. Open the deployed app, interact with the shell for ~30 seconds.
3. Clarity → eq-shell → Recordings should show the new session within a few minutes (Clarity batches uploads).

## Related files

- `src/observability.ts` — `initClarity` injects the official Clarity loader snippet with the project ID baked in.
- `src/main.tsx` — calls `initObservability()` before React mounts.
