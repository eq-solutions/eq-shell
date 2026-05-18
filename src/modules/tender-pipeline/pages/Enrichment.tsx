// Phase 2 — Enrichment slide-over panel. Vanilla source:
//   scripts/tender-pipeline.js:752 (openTenderPanel)
//
// Port plan:
//   1. Slide-over component (existing CSS-only pattern from EQ Field
//      modals; adopt or replace later).
//   2. `react-hook-form` for the enrichment form (nominations,
//      probability_pct, notes).
//   3. Same Supabase tables: `tender_enrichment`, `nominations`,
//      `nomination_clashes` (view).
//   4. Same PostHog event name: `tenderEnriched`.
//   5. Cross-org nomination collision detection preserved (vanilla
//      lines 158-166 in `loadAll`).

export default function Enrichment() {
  return (
    <section className="tp-page">
      <h2>Enrichment panel</h2>
      <p>Phase 2 — coming. Migrates from <code>scripts/tender-pipeline.js</code> lines 752-961.</p>
    </section>
  );
}
