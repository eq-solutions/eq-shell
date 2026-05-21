// Lazy-loaded stub for the Quotes module. Per the post-cull strategy
// (2026-04-29), Quotes is position 4 in the module-mounting queue —
// after Field has 20 paying customers.

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
      eta="Position 4 in the EQ Shell mounting queue. Lands after EQ Field hits 20 paying customers (per the post-cull validation gate)."
    />
  );
}
