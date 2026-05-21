// Lazy-loaded stub for the Service module. Per CLAUDE.md, EQ Service
// (eq-solves-service) is in active development as a separate app —
// CMMS / maintenance checks / defect tracking / testing workflows.
// This shell mount is the eventual in-shell home; for now it's a
// pointer to the standalone build.

import ComingSoon from '../pages/ComingSoon';

export default function ServiceModule() {
  return (
    <ComingSoon
      module="Service"
      description="EQ Service (eq-solves-service) — CMMS for trade subcontractors. Maintenance checks, defect tracking, customer reports, testing workflows. Currently in active development as a standalone app; in-shell mount lands once Field is on canonical end-to-end."
      features={[
        'Asset register (port from EQ Field assets)',
        'Maintenance check schedules (PPM)',
        'Defect tracker with photo evidence',
        'Customer service reports (PDF)',
        'Cross-app: convert defect → quote in one click',
      ]}
      eta="Standalone build first (eq-solves-service.netlify.app). In-shell mount after EQ Field's canonical-resource-model is live."
    />
  );
}
