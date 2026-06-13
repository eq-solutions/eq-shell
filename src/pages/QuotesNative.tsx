import { useState, useEffect } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { createSKSSupabaseClient } from '../lib/sksSupabaseClient';
import { QuotesModule } from '../modules/quotes/QuotesModule';

const SIDEBAR_RECORDS = defaultSidebarRecords();

export default function QuotesNative() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    createSKSSupabaseClient()
      .then(setClient)
      .catch((e: unknown) => {
        setClientError(e instanceof Error ? e.message : 'Failed to connect to sks-canonical.');
      });
  }, []);

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
        {clientError ? (
          <div style={{
            padding: '16px 20px',
            background: 'var(--eq-error-bg, #fef2f2)',
            color: 'var(--eq-error-text, #b91c1c)',
            borderRadius: 6,
            fontSize: 13,
          }}>
            {clientError}
          </div>
        ) : (
          <QuotesModule supabase={client} />
        )}
      </div>
    </HubLayout>
  );
}

export { QuotesNative };
