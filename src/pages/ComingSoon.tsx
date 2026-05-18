// Stub for not-yet-built modules. Q5 lock — modules are loaded via
// React.lazy() so a tenant without an entitlement never pays the
// bandwidth cost. This file is the lazy-loaded chunk for every
// stub module today; each gets its own real module file in Phase 2+.

export interface ComingSoonProps {
  module: string;
}

export default function ComingSoon({ module }: ComingSoonProps) {
  return (
    <div className="eq-shell">
      <div className="eq-coming-soon">
        <h2>{module}</h2>
        <p>Coming soon. This module is part of the EQ Shell roadmap.</p>
      </div>
    </div>
  );
}
