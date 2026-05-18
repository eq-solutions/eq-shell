// Phase 2 — Pipeline kanban (drag-and-drop stages). Vanilla source:
//   scripts/tender-pipeline.js:542 (renderKanban)
//   scripts/tender-pipeline.js:587 (_renderKanbanGrid)
//
// Port plan:
//   1. `@dnd-kit/core` + `@dnd-kit/sortable` for the kanban DnD.
//      Stage columns = sortable containers; tender cards = sortable items.
//   2. Same stages as vanilla: watch / confirmed / likely / won / lost.
//   3. Realtime channel via `@supabase/supabase-js` — channel subscription
//      mirrors the vanilla one (org-scoped today; week-scoped on the
//      Melbourne sprint per FINDING #S3, parked).
//   4. Same PostHog event names: `tenderStageDragged`, `nominationAdded`,
//      `tenderPromoted`.

export default function Kanban() {
  return (
    <section className="tp-page">
      <h2>Pipeline kanban</h2>
      <p>Phase 2 — coming. Migrates from <code>scripts/tender-pipeline.js</code> lines 542-750.</p>
    </section>
  );
}
