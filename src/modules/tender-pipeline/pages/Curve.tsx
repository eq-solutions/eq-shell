// Phase 2 — Labour-curve confirmation. Vanilla source:
//   scripts/tender-pipeline.js:1457 (renderConfirmCurve)
//
// Port plan:
//   1. Curve editor — week-by-week labour allocation form. `react-hook-form`
//      array fields.
//   2. Same Supabase table: `pending_schedule` (rows promoted to
//      `schedule` on confirm).
//   3. Same PostHog event name: `labourCurveConfirmed`.
//   4. Touches EQ Field's `schedule` table — the shell side stays
//      read-only here; promotion still happens against the EQ tenant
//      Supabase via the canonical handoff (Phase 2 task).

export default function Curve() {
  return (
    <section className="tp-page">
      <h2>Labour Curve confirmation</h2>
      <p>Phase 2 — coming. Migrates from <code>scripts/tender-pipeline.js</code> lines 1457-1900.</p>
    </section>
  );
}
