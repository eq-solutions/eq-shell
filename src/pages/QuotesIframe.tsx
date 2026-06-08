import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';
import { EqError } from '../components/EqError';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// Embeds EQ Quotes (Flask) as a Shell iframe.
//
// Cookie auth (2026-05-28): the browser sends eq_shell_session automatically
// to quotes.eq.solutions (same eTLD+1 as core.eq.solutions). Flask verifies
// the HMAC via a before_app_request hook and sets a Quotes session on the
// fly. No token mint, no redirect — one onLoad = ready.
//
// The REQUEST_SHELL_TOKEN handler below is kept as a fallback for edge cases
// where Flask needs a fresh token (e.g. server restart cleared sessions).

const QUOTES_URL = 'https://quotes.eq.solutions';
const LOAD_TIMEOUT_MS = 30_000;

type Phase = 'loading' | 'ready' | 'error' | 'timeout';

export default function QuotesIframe() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('loading');
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setPhase('timeout');
      Sentry.captureMessage('EQ Quotes iframe did not load within timeout', { level: 'error' });
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [attempt]);

  // Legacy token refresh — keep the handler in case Flask sessions expire
  // and Quotes falls back to requesting a fresh HMAC token.
  useEffect(() => {
    // Fail closed: use hardcoded QUOTES_URL as fallback so the handler
    // never silently accepts messages from arbitrary origins.
    const expectedOrigin = (import.meta.env.VITE_QUOTES_URL as string | undefined) ?? QUOTES_URL;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (ev.origin !== expectedOrigin) return;
      const origin = expectedOrigin;
      try {
        const res = await fetch('/.netlify/functions/mint-quotes-iframe-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'SHELL_TOKEN_RESPONSE', error: 'refresh-failed' },
            origin,
          );
          return;
        }
        const body = (await res.json()) as { token: string };
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', token: body.token },
          origin,
        );
      } catch {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', error: 'refresh-failed' },
          origin,
        );
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function onIframeLoad() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('ready');
  }

  const src = `${QUOTES_URL}/?shell=1`;

  const failed = phase === 'error' || phase === 'timeout';

  return (
    <HubLayout iframe sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-service-frame-wrap">
        {phase === 'loading' && (
          <div className="eq-loading">Loading EQ Quotes…</div>
        )}
        {failed && (
          <div className="eq-iframe-error-wrap">
            <EqError
              title="EQ Quotes didn't load"
              message={
                phase === 'timeout'
                  ? 'It took too long to respond. Try again — if it keeps happening, reload the page.'
                  : "It couldn't be opened. Try again — if it keeps happening, reload the page."
              }
              onRetry={retry}
            />
          </div>
        )}
        {!failed && (
          <iframe
            ref={iframeRef}
            key={attempt}
            className="eq-service-frame"
            style={phase !== 'ready' ? { visibility: 'hidden', position: 'absolute' } : undefined}
            title="EQ Quotes"
            src={src}
            onLoad={onIframeLoad}
            sandbox="allow-scripts allow-forms allow-downloads"
            referrerPolicy="no-referrer"
            allow=""
          />
        )}
      </div>
    </HubLayout>
  );
}
