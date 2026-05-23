# Deploy preview environment variables — eq-shell runbook

## Why this exists

On 2026-05-23 we discovered that `https://deploy-preview-15--eq-shell.netlify.app/.netlify/functions/shell-login` returned `500 — Server misconfigured — missing SUPABASE_JWT_SECRET`, while the same endpoint on production (`https://core.eq.solutions`) worked fine. The cause: the server-side env vars in Netlify were scoped to **Production only**, so the **Deploy Preview** build context inherited nothing. Every PR's preview was un-loginable, which broke pre-merge smoke testing on every PR — silently, until someone tried to log in.

This runbook documents which vars must be scoped to Deploy Previews and how to verify before the next PR catches us out.

## Required scopes

In Netlify → eq-shell project → **Site configuration → Environment variables**, every var below must be available in the **Deploy Previews** context (either scoped to "All deploy contexts" or with "Deploy previews" explicitly ticked).

### Server-side — required for the function to run at all

| Variable | Used by | If missing |
|---|---|---|
| `SUPABASE_URL` | `netlify/functions/_shared/supabase.ts` | All functions 500 — can't connect to canonical DB |
| `SUPABASE_SERVICE_ROLE_KEY` | `netlify/functions/_shared/supabase.ts` | All functions 500 — can't auth to canonical DB |
| `EQ_SECRET_SALT` | `netlify/functions/_shared/token.ts` | `shell-login` 500s with `Server misconfigured — missing EQ_SECRET_SALT`. Must match eq-solves-field's salt — the cross-domain iframe handoff fails if they diverge. |
| `SUPABASE_JWT_SECRET` | `netlify/functions/_shared/supabase-jwt.ts` | `shell-login` 500s with `Server misconfigured — missing SUPABASE_JWT_SECRET`. The shell mints a Supabase-compatible JWT alongside the session cookie so the browser can talk to Supabase directly with the right `app_metadata`. |

### Server-side — optional but recommended on previews

| Variable | Used by | If missing |
|---|---|---|
| `SENTRY_DSN` | `netlify/functions/_shared/sentry.ts` | Server-side errors on previews silently no-op instead of surfacing in Sentry. Hard to diagnose preview-only regressions. |
| `EQ_EMAIL_PROVIDER` | `netlify/functions/_shared/email.ts` | Invite emails on preview don't send. Probably fine — you usually don't invite people from a preview. |

### Browser-side (`VITE_*`) — required for client features

| Variable | Used by | If missing |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts` (and similar) | Browser can't talk to Supabase directly; pages depending on direct queries 404 or hang. |
| `VITE_SUPABASE_ANON_KEY` | same | same |
| `VITE_SENTRY_DSN` | `src/observability.ts` | Browser errors silently no-op. Bootstrap log shows `[observability] Sentry disabled — VITE_SENTRY_DSN not set`. |
| `VITE_POSTHOG_KEY` | same | Product analytics disabled on previews. Probably fine — you usually don't want preview clicks in prod funnels. |
| `VITE_CLARITY_PROJECT_ID` | same | Session replay disabled on previews. Same caveat. |

The `VITE_*` vars are inlined at build time. If a `VITE_*` var is missing in the Deploy Previews context, *that preview's bundle has the var baked-out forever*, even after you fix the scope. Trigger a re-deploy of the preview after fixing.

## Verifying — UI

1. Netlify → eq-shell → **Site configuration → Environment variables**.
2. For each var in the tables above, click into it and check the **Scopes** section. The chip should say one of: **All deploy contexts**, or include **Deploy previews** explicitly.
3. If a var says **Production** only, click **Options → Edit** → toggle **Deploy previews** on → save.
4. Trigger a fresh deploy preview: in the PR, push a no-op commit (`git commit --allow-empty -m "chore: rebuild preview"`) and force-push, or in Netlify → **Deploys** → find the PR row → **Trigger deploy**.

## Verifying — automated (smoke script)

`scripts/smoke-preview.sh` checks the four critical preview endpoints and exits non-zero on any 500 with a `Server misconfigured` body:

```bash
./scripts/smoke-preview.sh https://deploy-preview-15--eq-shell.netlify.app
```

Output on success:

```
PASS  /.netlify/functions/verify-shell-session     401  (unauthenticated)
PASS  /.netlify/functions/shell-login              400  (empty-body)
PASS  /.netlify/functions/mint-iframe-token        401  (no-body-or-no-session)
PASS  all 3 endpoints returned the expected non-5xx status
```

Output on failure (today's symptom):

```
FAIL  /.netlify/functions/shell-login              500  {"error":"Server misconfigured — missing SUPABASE_JWT_SECRET"}
FAIL  preview env vars likely not scoped to Deploy Previews — see docs/runbooks/deploy-preview-env.md
```

Run it manually for now. Future work: wire into a GitHub Actions workflow that runs after each Netlify preview lands and blocks the PR check status until preview is green.

## What this runbook does NOT cover

- Per-PR env var overrides (you generally don't want them — the preview should mirror production scope).
- Branch-deploy context — same vars need scoping there too if you start using branch deploys for staging.
- Local `netlify dev` env injection — `netlify dev --context production` pulls from the linked project automatically once `netlify link` has run; no local `.env` required.
