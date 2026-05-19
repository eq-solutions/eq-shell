// Phase 2 — Fortnightly Review wizard. Vanilla source:
//   scripts/tender-pipeline.js:963 (renderReview)
//
// This is the adoption-critical screen — the fortnightly meeting Royce
// + the Construction Manager run is THE Tender Pipeline product. The
// migration must preserve the exact step shape so the meeting tempo
// doesn't change.
//
// Port plan:
//   1. Multi-step wizard via local component state (react-router doesn't
//      need to know about the steps). `react-hook-form` for the
//      pencilling form per row.
//   2. Decision queue rendered via `@tanstack/react-table` — sortable
//      columns matching vanilla `renderReview`.
//   3. Same PostHog event names: `reviewSessionStarted`,
//      `reviewSessionEnded`, `pencillingsSavedReview`, `decisionLogged`.
//   4. Six fortnightly reviews + 30+ notes at month 3 is the adoption
//      proof per EQ-SHELL-DESIGN.md — port preserves that arc.

export default function Review() {
  return (
    <section className="tp-page">
      <h2>Fortnightly Review</h2>
      <p>Phase 2 — coming. Migrates from <code>scripts/tender-pipeline.js</code> lines 963-1455.</p>
    </section>
  );
}
