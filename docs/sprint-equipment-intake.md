# Sprint: Equipment & Asset Intake — finish the loop

**Goal:** take "SimPRO CSV → canonical assets → home screen" from *working* to
*complete and delightful* — robust import, AI assistance, capture-from-photo, and
service-due intelligence — reusing infrastructure that already exists in the
stack. Every item below names the proven piece it builds on.

**Shipped (2026-05-30, PR #65):**
- Shell-dropzone commit fixed (routes through `intake-commit` orchestrator) — all
  domains unblocked.
- `/data/asset` Equipment browse view; Equipment KPI on home.
- `asset` count in `eq_tenant_dashboard_counts` (migration 0018, applied).

**Architecture note:** two-plane Supabase split — browser → control plane
(`eq-canonical`); tenant data server-only (`eq-canonical-internal`). Anything
touching `app_data.*` from the browser goes through a Netlify function.

---

## Phase 0 — Harden the path we just shipped  *(do first)*

| # | Task | Reuses | Size | Acceptance |
|---|---|---|---|---|
| 0.1 | **E2E smoke test** of sites→assets import→home count→`/data/asset` | `scripts/smoke-preview.sh`, `entity-rows`, dashboard RPC | M | A scripted run imports a 5-row fixture and asserts the count + rows appear |
| 0.2 | **"Import sites first" guard** on the Service asset importer — detect 0 sites and warn before drop | `DomainLanding`, `entity-rows?entity=site` | S | Dropping an asset CSV with no sites shows a clear inline prompt, not FK errors |
| 0.3 | **Asset detail drawer** fields + (optional) edit | `EntityBrowserPage` `EntityDetailDrawer`, `MANAGEABLE_ENTITIES`, `entity-actions` | S | Clicking an asset row shows make/model/serial/site/next-service; manager can toggle `active` |
| 0.4 | **Regression check** other domains still commit post-fix (field/quotes/core) | `intake-commit.ts` per-module RPCs | S | One import per domain succeeds against eq-canonical-internal |

---

## Phase 1 — AI on import  *(the @eq/ai classifier already runs here)*

| # | Task | Reuses | Size | Acceptance |
|---|---|---|---|---|
| 1.1 | **AI asset enrichment** — when a SimPRO row lacks `criticality`, `ppm_frequency`, or `asset_type`, infer it from `name`/`make`/`model` via the existing Claude `map()` path; surface as *suggested* values in the confirm UI (user approves) | `@eq/ai`, `classify.ts`, `@eq/confirm-ui` flagged-rows | M | A CSV with only name+make yields suggested asset_type + PPM the user can accept/reject before commit |
| 1.2 | **Duplicate / merge detection** — flag likely dupes (same `serial_number`, or same `external_id` at a site) pre-commit; offer skip-or-upsert | `@eq/confirm-ui` flag pattern, `eq_intake_commit_batch_service` upsert mode (already supports `ON CONFLICT (asset_id)`) | M | Re-importing the same SimPRO export flags 100% as dupes; upsert updates instead of duplicating |
| 1.3 | **Site fuzzy-match review** — show the FK match the importer chose (`site_id` ← site name/code) with confidence, let the user correct | `asset.schema.json` `x-eq-fk-fuzzy-match-on`, confirm UI | M | Ambiguous site names surface a picker instead of silently mis-linking |

---

## Phase 2 — Capture, not just import  *(readers already exist in @eq/intake)*

| # | Task | Reuses | Size | Acceptance |
|---|---|---|---|---|
| 2.1 | **Nameplate photo → asset** — snap an equipment nameplate, extract make/model/serial, prefill a new asset | `@eq/intake/readers/photo.ts` (already built), `@eq/ai`, `asset-calibration.ts` create path | L | A photo of a switchboard nameplate creates a draft asset with make+serial filled |
| 2.2 | **PDF spec/asset-register → assets** — pull rows from a born-digital PDF equipment schedule | `@eq/intake/readers/pdf.ts` (already built), confirm UI | M | A PDF asset register imports through the same confirm→commit flow as CSV |
| 2.3 | **QR/barcode per asset** — generate a printable QR from the `barcode` field; scan opens `/data/asset` detail | `assets.barcode` column, browse route | M | Each asset has a printable QR; scanning it deep-links to its detail |

---

## Phase 3 — Make the data earn its keep  *(canonical events + AI briefing exist)*

| # | Task | Reuses | Size | Acceptance |
|---|---|---|---|---|
| 3.1 | **Service-due intelligence on home** — KPI/alert "N equipment overdue / due this month" from `next_service_due`; weave one line into the existing AI briefing | `eq_tenant_dashboard_counts`, `ai-briefing` function, `next_service_due` | M | Home shows overdue count; briefing mentions it when >0 |
| 3.2 | **Emit canonical events on import** — write `asset.imported` (and later `asset.service_due`) so the cross-app live feed reflects equipment activity | `app_data.canonical_events`, `eq_write_canonical_event` RPC | S | Importing assets adds an entry to the home live feed |
| 3.3 | **Asset hierarchy from SimPRO** — populate `parent_asset_id` (breaker → switchboard) via the parent aliases | `asset.schema.json` `parent_asset_id` + aliases, schema FK | M | A SimPRO export with parent refs builds a 2-level asset tree, shown in detail |
| 3.4 | **Bridge to EQ Service** — serviceable assets feed EQ Service maintenance schedules; `plant_equipment` continues to feed the calibration module | EQ Service `shell-auth`, `src/modules/equipment` | L | An imported serviceable asset is selectable in EQ Service; calibration view unaffected |

---

## Recommended one-sprint cut

If we want a tight, high-impact sprint rather than all 14 items:

**"Import you can trust + one wow":**
- Phase 0 in full (0.1–0.4) — make the shipped path solid.
- 1.1 AI enrichment + 1.2 dup detection — the import becomes smart.
- 3.1 service-due on home + 3.2 canonical events — the data visibly pays off.
- Stretch: 2.1 nameplate photo (the demo magnet — the reader already exists).

Everything else (PDF, QR, hierarchy, EQ Service bridge) becomes Sprint 2.

## Sequencing notes
- 0.x before everything (don't build on an unverified base).
- 1.2 depends on upsert mode — already implemented in `eq_intake_commit_batch_service`.
- 3.4 is the largest and crosses repos (eq-shell ↔ eq-solves-service) — schedule last.
