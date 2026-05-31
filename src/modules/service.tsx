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
      description="Maintenance checks, defect tracking, customer reports, and testing workflows — built for trade teams. In active development as a standalone app today."
      features={[
        'Asset register (port from EQ Field assets)',
        'Maintenance check schedules (PPM)',
        'Defect tracker with photo evidence',
        'Customer service reports (PDF)',
        'Cross-app: convert defect → quote in one click',
      ]}
      eta="Available now as a standalone app. Full integration into this hub is coming."
    />
  );
}
