# Gotenberg — HTML to PDF service

> **STATUS as of 2026-04-26: decommissioned.** We tried Gotenberg-on-Fly for an
> HTML→PDF reporting path and hit Chromium boot-timing reliability issues on
> shared-CPU Fly machines. Decision was to defer the PDF path and stay
> DOCX-only in the short term (see `docs/30-day-plan.md` item C5).
>
> This directory is **kept as reference** so a future revival doesn't have to
> re-derive the deploy config. The Fly app itself was destroyed on 2026-04-26.
> If reviving: re-run `fly launch --copy-config --no-deploy` from this
> directory and `fly deploy`. Note the lessons learned in §"Known gaps" below.

This directory holds the deploy config for a Gotenberg instance on Fly.io.

## What it is

Gotenberg is a stateless HTTP service that takes HTML and returns a PDF.
We use it as the rendering backend for every customer-facing report the app
generates (maintenance check, ACB test, NSX test, compliance, defect register,
work order details).

The app code in `lib/reports/pdf-renderer.ts` is a thin wrapper that POSTs HTML
to this service and returns the PDF buffer. If we ever swap the rendering
backend (Browserless, self-hosted Chromium, etc.), only that one file changes.

## Deploy

From this directory:

```bash
fly launch --copy-config --no-deploy
fly deploy
```

After the first deploy, Fly assigns a public URL — copy it into Netlify env as
`GOTENBERG_URL`.

## Operate

```bash
fly status              # is it running?
fly logs                # tail logs
fly scale memory 2048   # bump RAM if large reports OOM
fly scale count 2       # add a machine to handle concurrent renders
```

## Known gaps + lessons from 2026-04-26 attempt

- **Chromium boot reliability on shared-CPU.** The blocker that killed this
  attempt. Gotenberg spawns a fresh Chromium process per render. On Fly's
  `shared-cpu-1x` (even with 2GB RAM) Chromium frequently failed to bind its
  DevTools websocket within the timeout — surfacing as "websocket url
  timeout reached" in Gotenberg logs and HTTP 500 to callers. Variable
  latencies (180ms hard fail to 84s slow success) suggest CPU contention.
  - **Mitigation if revived:** use `performance-1x` ($25/mo) for dedicated
    CPU. Do not rely on shared-CPU. Or pivot to Browserless ($30/mo) which
    runs a managed Chromium cluster.
- **No authentication.** The Fly URL alone gates access. Before routing real
  customer reports through this service, add basic auth (Caddy sidecar with
  `basicauth` directive, or nginx with `auth_basic`). Was deferred to
  Phase 1c and never reached.
- **Cold starts.** With `min_machines_running = 0`, the first request after
  idle takes 5–10s while Fly boots a machine and Fly's proxy returns
  generic 500 if the wake exceeds proxy timeout. Setting
  `min_machines_running = 1` keeps one warm; not enough on its own to fix
  the Chromium-per-render boot problem above.
- **Form-data multipart quirk.** Node's built-in `FormData` drops the
  filename argument for `Blob` values in multipart serialisation. Use
  `new File([html], 'index.html', { type: 'text/html' })` not `new Blob(...)`
  so Gotenberg sees the required `index.html` filename. (Captured in
  `lib/reports/pdf-renderer.ts` for if/when this code is reused.)
