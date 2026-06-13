import { useEffect } from 'react';
import { HubLayout } from '../components/HubLayout';

const EQ_QUOTES_URL = 'https://quotes.eq.solutions';

export default function EqQuotesExternal() {
  useEffect(() => {
    window.open(EQ_QUOTES_URL, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <HubLayout>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 40, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--eq-ink)', margin: 0 }}>EQ Quotes</h2>
        <p style={{ fontSize: 14, color: 'var(--eq-muted)', margin: 0, maxWidth: 340 }}>
          EQ Quotes has opened in a new tab. Use it to create and edit quotes — they'll appear in EQ Ops automatically.
        </p>
        <a
          href={EQ_QUOTES_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: 'var(--eq-primary)', color: '#fff', borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
        >
          Open EQ Quotes ↗
        </a>
      </div>
    </HubLayout>
  );
}

export { EqQuotesExternal };
