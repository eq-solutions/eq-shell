// Lazy-loaded stub for the Quotes module.
//
// Quotes currently lives as a standalone Flask app at quotes.eq.solutions.
// The in-shell module here is a placeholder until Quotes is rebuilt as a
// React shell module backed by the per-tenant canonical data plane (see
// docs/ARCHITECTURE-V2.md). Sequencing is driven by what Royce needs next
// for SKS NSW operations, not by external customer demand.

import ComingSoon from '../pages/ComingSoon';

export default function QuotesModule() {
  return (
    <ComingSoon
      module="Quotes"
      description="EQ Quotes will reuse the v1 Flask pilot's logic — scope tree, rate library, labour curve — rebuilt as a React shell module backed by the canonical schema."
      features={[
        'Scope tree builder with rate-library autocomplete',
        'Labour-curve estimator (defaults from historical jobs)',
        'PDF + Outlook draft export',
        'Cross-app: quote a defect from EQ Service in one click',
        'Cross-app: pull staff costs from EQ Field per assignment',
      ]}
      eta="Standalone today at quotes.eq.solutions. In-shell rebuild sequenced after the per-tenant data plane migration completes."
    />
  );
}
