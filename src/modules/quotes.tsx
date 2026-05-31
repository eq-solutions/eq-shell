// Lazy-loaded shell module for EQ Quotes.
//
// EQ Quotes lives at quotes.eq.solutions (standalone Flask app today). The
// in-shell rebuild is a Phase 3+ item — sequenced after Field unification.
// Until then this module is a deliberate, useful pointer rather than a
// "Coming soon" stub that lands trial users in a dead end.
//
// Trial users don't see this tile at all (TenantHome hides it for tier='trial').
// Paying tiers see this surface and can jump straight to the standalone app.

import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

const STANDALONE_URL = 'https://quotes.eq.solutions';

export default function QuotesModule() {
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-page__header">
        <h1 className="eq-page__title">EQ Quotes</h1>
        <p className="eq-page__lede">
          Build quotes, manage your rate library, and send proposals.
        </p>
      </div>

      <div
        style={{
          maxWidth: 640,
          padding: 24,
          border: '1px solid #EAF5FB',
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <p style={{ margin: '0 0 16px', color: 'var(--eq-ink, #1A1A2E)' }}>
          EQ Quotes runs as a separate app at{' '}
          <a
            href={STANDALONE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--eq-deep, #2986B4)', fontWeight: 500 }}
          >
            quotes.eq.solutions
          </a>
          . Sign in with the same email you use here.
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--eq-ink, #1A1A2E)', opacity: 0.7 }}>
          We're building a full Quotes experience right into this hub. Until
          it's ready, the standalone app does the job — same data, same login.
        </p>
        <a
          href={STANDALONE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="eq-btn-primary"
          style={{ display: 'inline-block' }}
        >
          Open EQ Quotes →
        </a>
      </div>
    </HubLayout>
  );
}
