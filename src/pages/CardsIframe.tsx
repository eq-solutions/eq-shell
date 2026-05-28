// Embeds the EQ Cards Flutter web build as an iframe.
//
// Cookie auth (2026-05-28): the browser sends eq_shell_session automatically
// to cards.eq.solutions (same eTLD+1). On load, the Flutter app calls
// /.netlify/functions/shell-verify (same-origin GET), gets a Supabase JWT,
// and calls setSession() — no JWT in URL hash or browser history.
//
// JWT refresh: when the 15-min JWT expires, Flutter posts REQUEST_SHELL_TOKEN.
// Shell mints a fresh JWT via mint-cards-iframe-token and responds with
// SHELL_TOKEN_RESPONSE so Flutter can call setSession() again.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';

const CARDS_URL = 'https://cards.eq.solutions/';
const LOAD_TIMEOUT_MS = 30_000;

type Phase = 'loading' | 'ready' | 'load-error';

export default function CardsIframe() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState(0);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const clearLoadTimer = () => {
    if (loadTimerRef.current !== null) {
      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
  };

  const retry = useCallback(() => {
    clearLoadTimer();
    setPhase('loading');
    setAttempt((n) => n + 1);
  }, []);

  // Load timeout — start counting once the component mounts (or retries).
  useEffect(() => {
    if (phase !== 'loading') return;
    loadTimerRef.current = setTimeout(() => {
      setPhase('load-error');
      Sentry.captureMessage(
        `Cards iframe did not fire onLoad within ${LOAD_TIMEOUT_MS / 1000}s`,
        { level: 'error' },
      );
    }, LOAD_TIMEOUT_MS);
    return clearLoadTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attempt]);

  // JWT refresh — respond to REQUEST_SHELL_TOKEN from the Cards iframe.
  useEffect(() => {
    // Fail closed: use CARDS_URL origin as fallback so the handler
    // never silently accepts messages from arbitrary origins.
    const cardsOrigin = new URL(CARDS_URL).origin;
    const expectedOrigin = (import.meta.env.VITE_CARDS_URL as string | undefined) ?? cardsOrigin;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (ev.origin !== expectedOrigin) return;
      const origin = expectedOrigin;
      try {
        const res = await fetch('/.netlify/functions/mint-cards-iframe-token', {
          method: 'POST',
          credentials: 'include',
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

  const onIframeLoad = () => {
    clearLoadTimer();
    setPhase('ready');
  };

  if (phase === 'load-error') {
    return (
      <HubLayout iframe>
        <div
          className="eq-iframe-error"
          role="alert"
          style={{ margin: 28, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}
        >
          <p style={{ margin: 0, color: '#1A1A2E' }}>
            EQ Cards took too long to load. Try again — if the problem persists, reload the page.
          </p>
          <button
            type="button"
            className="eq-btn eq-btn--sm"
            onClick={retry}
            style={{ alignSelf: 'flex-start' }}
          >
            Try again
          </button>
        </div>
      </HubLayout>
    );
  }

  return (
    <HubLayout iframe>
      {phase === 'loading' && (
        <div className="eq-loading eq-loading--overlay" aria-busy="true">
          Opening EQ Cards…
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={attempt}
        className="eq-cards-frame"
        style={{ flex: 1, minHeight: 0 }}
        title="EQ Cards"
        src={`${CARDS_URL}?shell=1`}
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
        referrerPolicy="no-referrer"
        allow=""
        onLoad={onIframeLoad}
      />
    </HubLayout>
  );
}
