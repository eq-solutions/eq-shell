// STALE 2026-05-20 — Tender Pipeline scaffolding kept as future-exploration
// reference but NOT on the Phase 2 roadmap. Per eq/products.md + 2026-05-20
// part-d: Tender Pipeline is a Field sub-module, not a flagship shell
// module. Mount is still wired in App.tsx because the route table needs
// it to stay valid; the screens themselves are placeholders. Delete-or-
// keep decision remains pending Royce confirmation (CLAUDE.md no-delete
// rule blocks unilateral removal).
//
// Phase 2 spike v2 — Tender Pipeline module root.
//
// Phase 2 of EQ-SHELL-DESIGN.md is the adoption-wedge migration: the
// 5 Tender Pipeline screens from vanilla EQ Field (v3.4.79-83) port
// to React shell routes. This file is the spike — placeholder routes
// for each of the 5 screens, each its own React.lazy() chunk per Q5.
//
// Mount point (Phase 1.B router): /<tenant>/tender-pipeline/*
//   → wrapped by Phase 1.B's RequireSession + ModuleGate("tender_pipeline")
//   → this file owns sub-routes under that mount.
//
// Sub-routes:
//   /kanban      — Pipeline kanban (vanilla: tender-pipeline.js:542)   [default]
//   /import      — Tender Sync xlsx import (vanilla: tender-pipeline.js:276)
//   /review      — Fortnightly Review (vanilla: tender-pipeline.js:963)
//   /enrichment  — Enrichment slide-over panel (vanilla: tender-pipeline.js:752)
//   /curve       — Labour-curve confirmation (vanilla: tender-pipeline.js:1457)
//
// Phase 2 proper lands one sub-route per follow-up PR. This spike
// scaffolds the routes + nav only; each page is a placeholder.

import { lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Outlet, Navigate } from 'react-router-dom';

const ImportPage = lazy(() => import('./pages/Import'));
const KanbanPage = lazy(() => import('./pages/Kanban'));
const ReviewPage = lazy(() => import('./pages/Review'));
const EnrichmentPage = lazy(() => import('./pages/Enrichment'));
const CurvePage = lazy(() => import('./pages/Curve'));

function Layout() {
  return (
    <div className="tp-shell">
      <header className="tp-header">
        <h1>Tender Pipeline</h1>
        <p className="tp-lede">Phase 2 spike — placeholder routes for the 5 vanilla screens.</p>
        <nav className="tp-nav">
          <NavLink to="kanban">Pipeline</NavLink>
          <NavLink to="review">Fortnightly Review</NavLink>
          <NavLink to="enrichment">Enrichment</NavLink>
          <NavLink to="import">Tender Sync</NavLink>
          <NavLink to="curve">Labour Curve</NavLink>
        </nav>
      </header>
      <main className="tp-main">
        <Suspense fallback={<div className="tp-loading">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

export default function TenderPipeline() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="kanban" replace />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="kanban" element={<KanbanPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="enrichment" element={<EnrichmentPage />} />
        <Route path="curve" element={<CurvePage />} />
        <Route path="*" element={<Navigate to="kanban" replace />} />
      </Route>
    </Routes>
  );
}
