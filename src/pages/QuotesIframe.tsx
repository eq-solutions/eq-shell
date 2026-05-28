import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';

// Embeds EQ Quotes (Flask) as a Shell iframe.
//
// Auth flow:
//   1. Shell mints a 60s HMAC token via mint-quotes-iframe-token.
//   2. Shell embeds Quotes at https://quotes.eq.solutions/auth/shell-auth?token=<token>
//   3. /auth/shell-auth validates the HMAC, sets the Flask session, redirects to /.
//   4. The quotes list renders — iframe is live.
//
// Unlike Service (Next.js), Quotes is a server-rendered Flask app with no
// postMessage readiness signal. We rely on onLoad count instead:
//   - Load 1: /auth/shell-auth page (Flask processes token + redirects)
//   - Load 2: / (quotes list — auth complete)
// Two onLoad events = the auth round-trip finished.

const QUOTES_URL = 'https://quotes.eq.solutions';

const QUOTES_TIMEOUT_MS = 30_000;

type FrameState =
  | { phase: 'minting' }
  | { phase: 'loading'; src: string }
  | { phase: 'ready'; src: string }
  | { phase: 'error'; msg: string };

export default function QuotesIframe() {
  const [state, setState] = useState<FrameState>({ phase: 'minting' });
  const loadCount = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/mint-quotes-iframe-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          if (!cancelled) setState({ phase: 'error', msg: 'Could not authorise EQ Quotes. Sign out and back in.' });
          return;
        }
        const { token } = (await res.json()) as { token: string };
        if (!cancelled) {
          setState({
            phase: 'loading',
            src: `${QUOTES_URL}/auth/shell-auth?token=${encodeURIComponent(token)}`,
          });
        }
      } catch {
        if (!cancelled) setState({ phase: 'error', msg: 'Network error reaching EQ Quotes. Check your connection.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.phase !== 'loading') return;
    const timer = setTimeout(() => {
      Sentry.captureMessage('EQ Quotes iframe did not load within timeout', { level: 'error' });
      setState((prev) =>
        prev.phase === 'loading'
          ? { phase: 'error', msg: 'EQ Quotes took too long to respond. Try refreshing.' }
          : prev,
      );
    }, QUOTES_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // Respond to token refresh requests from the Quotes iframe.
  useEffect(() => {
    const expectedOrigin = import.meta.env.VITE_QUOTES_URL as string | undefined;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (expectedOrigin) {
        if (ev.origin !== expectedOrigin) return;
      }
      const origin = expectedOrigin ?? ev.origin;
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
    loadCount.current += 1;
    // Load 1 = /auth/shell-auth (processing + redirect).
    // Load 2 = / (quotes list rendered — auth complete).
    if (loadCount.current >= 2) {
      setState((prev) => (prev.phase === 'loading' ? { ...prev, phase: 'ready' } : prev));
    }
  }

  const src = state.phase === 'loading' || state.phase === 'ready' ? state.src : null;

  return (
    <HubLayout iframe>
      <div className="eq-service-frame-wrap">
        {(state.phase === 'minting' || state.phase === 'loading') && (
          <div className="eq-loading">
            {state.phase === 'minting' ? 'Authorising EQ Quotes…' : 'Loading EQ Quotes…'}
          </div>
        )}
        {state.phase === 'error' && (
          <div className="eq-error" role="alert">{state.msg}</div>
        )}
        {src && (
          <iframe
            ref={iframeRef}
            className="eq-service-frame"
            style={state.phase !== 'ready' ? { visibility: 'hidden', position: 'absolute' } : undefined}
            title="EQ Quotes"
            src={src}
            onLoad={onIframeLoad}
            sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
            referrerPolicy="no-referrer"
            allow=""
          />
        )}
      </div>
    </HubLayout>
  );
}
