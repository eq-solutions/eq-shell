# @eq/intake-demo

A Vite + React app that drops `@eq/confirm-ui` into a real browser. Drag a
CSV / XLSX / PDF / photo in, watch the file flow through parse → classify
→ AI map → validate → commit.

The point isn't the demo. The point is to prove the `@eq/confirm-ui`
component is something anyone can drop into a React app, configure with
a target schema and a commit function, and ship.

## Run it

From the workspace root:

```
pnpm --filter @eq/intake-demo dev
```

Opens at `http://localhost:5174`. No API key required — the demo ships
with a `MockAi` provider that does identity / alias mapping with a fake
600ms delay so the spinners stay visible.

## AI provider — mock by default, real Anthropic optional

The demo picks an AI provider at startup based on env vars (Vite only
exposes `VITE_`-prefixed variables to the browser bundle):

| Env var                    | Behaviour                                                  |
|----------------------------|------------------------------------------------------------|
| _(none set)_               | Uses `MockAi`. Offline, deterministic, no API call.         |
| `VITE_ANTHROPIC_API_KEY=…` | Uses real `AnthropicProvider`. Calls hit api.anthropic.com. |
| `VITE_ANTHROPIC_BASE_URL=…`| Optional. Overrides the API base URL. See "CORS caveat".    |

The pill in the demo header (`AI: mock` or `AI: real Anthropic`) tells
you at a glance which path is live. The same line appears in the browser
console at startup. The key value itself is never logged or rendered.

### Setting the env var

Create `eq-intake-demo/.env.local` (gitignored at both repo and monorepo
level — `.gitignore` covers `.env*`):

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

Restart the dev server. The pill should flip to green / "real Anthropic".

### CORS caveat

Browser direct calls to `api.anthropic.com` are typically **blocked by
CORS** unless your origin is explicitly allowlisted on the Anthropic side.
That means a naïve "set the key and run" will fail with a CORS error in
the network tab.

Two ways through:

1. **Run a tiny local proxy** that forwards `/messages` to
   `https://api.anthropic.com/v1/messages` and adds the `x-api-key`
   header server-side. Then point the demo at it:

   ```
   VITE_ANTHROPIC_BASE_URL=http://localhost:3001/anthropic/v1
   ```

   The proxy keeps the key off the client entirely — recommended for
   anything beyond a one-off poke. A tiny `vite-plugin-mkcert` /
   `express` / `cloudflare-worker` proxy is all this needs.

2. **Run the demo via a same-origin reverse-proxy** (e.g. behind nginx).
   Same idea, different mechanism.

### Why the key lands in the browser bundle

Vite inlines every `VITE_*` env var into the built JS. Anyone with the
URL can read the key out of the bundle. **Do not** set a real production
Anthropic key here for a hosted demo — use a proxy with a server-side
key, or a key with strict spend limits scoped to demo usage only.

For local-only `pnpm dev` runs against your own machine, a personal dev
key with a low spend cap is the pragmatic move.

## Sample data

The demo has two "Download sample" buttons:

- **Clean** — column names match the canonical schema exactly. The
  mapper hits identity on every column.
- **Messy** — uses real-world aliases (`First`, `Surname`, `Mail`,
  `Mob`, `FT`, `Sub`, `1/3/2022`, `0412 345 678`, `Y`). Forces the
  mapper to do alias resolution + the coercers to do AU-date / E.164
  / Y/N work. This is the realistic case — what an actual SimPRO
  export will look like.

## File formats

| Format       | Path                                            |
|--------------|-------------------------------------------------|
| CSV / TSV    | Papa Parse. Single sheet.                       |
| XLSX / XLS   | SheetJS. Multi-sheet workbooks land on the SheetPicker screen. |
| PDF (text)   | pdf.js. One ParsedSheet per page.               |
| PDF (scanned)| Routes to the vision path — requires AI provider. |
| JPEG / PNG / WebP / HEIC | Vision path — requires AI provider. |

## Commit

The demo's commit function is a log-only stub — it pretends to send the
rows to `eq_intake_commit_batch()` and writes a JSON summary of each
row to the in-page commit log. Real Supabase wiring is a Phase-2 task.
The "Download committed rows (CSV)" button on the complete screen
generates a CSV of whatever would have gone to commit, so the bookkeeper
has an audit trail without the server.

## Mobile

Works down to 360px. Tested via Chrome dev-tools device emulation
(iPhone SE column). Tables collapse to stacked cards, dropzone stays
large and tappable, the sheet picker stacks vertically.
