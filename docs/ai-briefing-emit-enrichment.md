# AI brief — event enrichment follow-ups (emit side)

The dashboard brief ([netlify/functions/ai-briefing.ts](../netlify/functions/ai-briefing.ts))
now does best-effort in-DB enrichment: it resolves `site_id` / `staff_id` inside
`canonical_events` payloads to names via `loadNameMaps()`. But two event shapes
can't be enriched from eq-shell because the **emitting app** doesn't put
resolvable data in the payload. These are the remaining gaps and they live in
other repos.

## 1. Field `shift.started` carries no names — only site codes + headcounts

Live SKS payload example:

```json
{ "day": "fri", "date": "2026-06-05", "week": "01.06.26",
  "assignments": { "SY5": 8, "SYD53": 10, "ARN": 5, "WSA": 1, ... },
  "scheduled_count": 150, "leave_count": 0 }
```

- The keys are **site/job codes**, not `site_id`s — `loadNameMaps()` can't resolve
  them (the maps key on `app_data.sites.site_id`).
- There are **no worker names**, yet the brief's system prompt instructs the model
  to populate `on_shift` with "name and site from payload". Result: the On-Shift
  panel is always empty for SKS.

**Fix (repo: eq-solves-field / sks-nsw-labour emitter):** when emitting
`shift.started`, either (a) include a `sites` map of `code → human name`, or (b)
include a small `on_shift` array of `{ name, site }` for the notable assignments.
Keep payload bounded (don't inline 150 names) — the brief only needs the headline
few plus the totals it already gets.

## 2. Service `maintenance_check.overdue` uses Service-domain UUIDs

Live SKS payload:

```json
{ "site_id": "fce67cfd-...", "check_id": "69672ad4-...", "days_overdue": 4 }
```

- That `site_id` **does not exist** in the SKS Field `app_data.sites` table — it's
  a Service-side identifier. So `loadNameMaps()` leaves it as a bare UUID and the
  model can only say "a maintenance check is overdue", never *which* site/check.

**Fix (repo: eq-solves-service emitter):** include human-readable fields in the
payload — `site_name`, `check_name` (and optionally `asset_name`) — alongside the
ids. The brief renders payload JSON verbatim, so any added name field is picked up
with no eq-shell change.

## What eq-shell already does (no further action)

- Resolves `site_id` / `staff_id` → name where they DO resolve in the tenant's
  `app_data.sites` / `app_data.staff` (e.g. the new licence / service-due / incident
  signals are fully named because they query those tables directly).
- Reads the rich operational tables directly (licences, assets service/calibration,
  defects, incidents) so the brief no longer depends solely on the thin event log.

## Pipeline: native reader is live but dormant

`ai-briefing.ts` now resolves the pipeline summary **native-first**:
`resolvePipeline()` reads `app_data.tenders` on the EQ Field SKS tenant
(`fetchNativePipeline`) and only falls back to the legacy external fetch
(`sks-nsw-labour/.netlify/functions/pipeline-summary`) when there are no tender
rows. Today `ehowg.app_data.tenders` is **empty**, so every request still falls
back to the external endpoint — the native path is dormant until pipeline data
becomes native EQ Field data.

When the Field unification port lands tender data into `ehowg.tenders`, the brief
switches to the native summary automatically and the external `pipeline_url` /
`pipeline_api_key` columns + the cross-entity HTTP call can be retired.

Two known limits of the native summary, to close when the port happens:
- **Stage classification is by substring** (`verbal` / `confirm|won|award` /
  dead-stage exclusion) because the tender stage vocabulary isn't fixed in schema.
  Revisit once the real stage values are known.
- **Capacity (headcount / peak_demand / bench) is not derivable from `tenders`** —
  it needs the resourcing model the port will bring. Left at 0/null; the brief
  omits the capacity line until it's sourced.

## Contract note

Both fixes are **purely additive** to existing event payloads — the brief reads
payloads as opaque JSON, so adding name fields can't break the receiver. No
`token.ts` / auth-boundary change. Coordinate with the canonical-events contract
in `eq-context/cross-repo-contracts-*.md`.
