// Phase 2 — Tender Sync (xlsx import). Vanilla source:
//   scripts/tender-pipeline.js:276 (renderImport)
//   scripts/tender-pipeline.js:318 (_onImportFile)
//   scripts/tender-pipeline.js:344 (_renderImportPreview)
//   scripts/tender-parser.js (whole file — ~346 lines, SheetJS parser)
//
// Port plan (next PR, not this spike):
//   1. Port `scripts/tender-parser.js` to TypeScript verbatim under
//      `src/modules/tender-pipeline/lib/tenderParser.ts`. SheetJS via
//      the `xlsx` npm dep (bundled, no CDN — diverges from vanilla).
//   2. Upload UI as a `react-hook-form` form. Existing xlsx ergonomics
//      preserved.
//   3. Diff preview (new / stage changed / value changed / missing) via
//      `@tanstack/react-table` — same columns as vanilla `_renderImportPreview`.
//   4. PostHog event name preserved: `tenderImported` with the same
//      6-count payload (rows_total / rows_new / rows_stage_changed /
//      rows_value_changed / rows_missing / rows_below_threshold).
//   5. Data plane DEFERRED — Import builds against a typed
//      `TenderRepository` interface; mock implementation lets the UI
//      render. Real Supabase wiring waits on the per-tenant data-plane
//      design decision (eq-shell-control vs. per-tenant anon clients
//      vs. Netlify proxy).

export default function Import() {
  return (
    <section className="tp-page">
      <h2>Tender Sync — xlsx import</h2>
      <p>Phase 2 — coming. Migrates from <code>scripts/tender-pipeline.js</code> lines 276-540.</p>
    </section>
  );
}
