import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HubLayout } from '../components/HubLayout';
import { Skeleton } from '../components/Skeleton';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { createTenantDataClient } from '../lib/tenantDataClient';
import { createSKSSupabaseClient } from '../lib/sksSupabaseClient';
import { QuotesModule } from '../modules/quotes/QuotesModule';
import { useSession } from '../session';

const SIDEBAR_RECORDS = defaultSidebarRecords();

function isAuthError(e: unknown): boolean {
  return e instanceof Error && /\b401\b/.test(e.message);
}

export default function QuotesNative() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [slow, setSlow] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setConnecting(true);
    setClientError(null);
    setSlow(false);

    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, 8_000);

    // Connect to the session tenant's data plane via the routed client. Fall
    // back to the legacy SKS-hardcoded client so live SKS testers can't be
    // broken by a routed-mint hiccup during the canonical cutover.
    (async () => {
      try {
        const c = await createTenantDataClient();
        if (!cancelled) { clearTimeout(slowTimer); setClient(c); setConnecting(false); }
      } catch (routedErr) {
        // 401 from mint-tenant-jwt means the session cookie has expired.
        // Redirect to login immediately rather than showing a connection error.
        if (isAuthError(routedErr)) {
          if (!cancelled) { clearTimeout(slowTimer); navigate('/', { replace: true }); }
          return;
        }
        try {
          const c = await createSKSSupabaseClient();
          if (!cancelled) { clearTimeout(slowTimer); setClient(c); setConnecting(false); }
        } catch (fallbackErr) {
          if (isAuthError(fallbackErr)) {
            if (!cancelled) { clearTimeout(slowTimer); navigate('/', { replace: true }); }
            return;
          }
          if (!cancelled) {
            clearTimeout(slowTimer);
            setClientError(routedErr instanceof Error ? routedErr.message : 'Failed to connect to the tenant database.');
            setConnecting(false);
          }
        }
      }
    })();
    return () => { cancelled = true; clearTimeout(slowTimer); };
  }, [retryCount, navigate]);

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
        {connecting ? (
          <div style={{ paddingTop: 8 }}>
            <Skeleton variant="text" width={320} />
            <Skeleton variant="text" width={240} />
            {slow && (
              <p style={{ color: 'var(--eq-mute)', fontSize: 13, marginTop: 12 }}>
                This is taking longer than usual — try refreshing if it doesn't load.
              </p>
            )}
          </div>
        ) : clientError ? (
          <div style={{
            padding: '16px 20px',
            background: 'var(--eq-error-bg, #fef2f2)',
            color: 'var(--eq-error-text, #b91c1c)',
            borderRadius: 6,
            fontSize: 13,
          }}>
            <p style={{ marginBottom: 10 }}>
              Couldn't open EQ Ops — check your connection and try again.
            </p>
            <button
              type="button"
              style={{
                fontSize: 13,
                padding: '5px 14px',
                borderRadius: 4,
                border: '1px solid currentColor',
                background: 'transparent',
                color: 'var(--eq-error-text, #b91c1c)',
                cursor: 'pointer',
              }}
              onClick={() => setRetryCount((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        ) : (
          <QuotesModule supabase={client} sessionName={session?.user.name} homeHref={session ? `/${session.tenant.slug}` : undefined} />
        )}
      </div>
    </HubLayout>
  );
}

export { QuotesNative };
